//! Priority task pool used by the image commands so the photo the user
//! is currently looking at always wins over background work like
//! folder-wide thumbnail batches and neighbour prefetching.
//!
//! Two dedicated worker pools:
//!
//! * **Foreground** workers drain `Urgent` and `Foreground` jobs.
//!   `Urgent` jumps the queue (push_front) so a navigation away from
//!   the active photo can re-task the foreground pool immediately.
//!   These workers never pick up `Background` jobs, so a slow RAW
//!   thumbnail can never block the next full-resolution decode.
//!
//! * **Background** workers drain only `Background` jobs (folder-wide
//!   thumbnail batches, full-image prefetches for neighbouring
//!   photos). They share the rest of the CPU cores.
//!
//! Each submitted job gets an optional `request_id` so the frontend
//! can flip its [`CancelToken`]. Workers check the flag before
//! starting work; long-running tasks can also poll cooperatively.
//! Jobs that arrive already-cancelled are skipped without running.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Priority {
    /// Block on the foreground pool, jumping ahead of queued Foreground
    /// jobs. Use for the photo the user is actively viewing.
    Urgent,
    /// Foreground pool, FIFO. Use for visible-but-not-active UI like
    /// thumbnail cards in the current viewport.
    Foreground,
    /// Background pool. Use for prefetch and folder-wide batches.
    Background,
}

impl Priority {
    pub fn parse(s: Option<&str>) -> Self {
        match s.unwrap_or("") {
            "urgent" => Priority::Urgent,
            "background" => Priority::Background,
            // Default to foreground so older invocations stay snappy.
            _ => Priority::Foreground,
        }
    }
}

#[derive(Clone)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
    fn pre_cancelled() -> Self {
        Self(Arc::new(AtomicBool::new(true)))
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

struct Job {
    cancel: CancelToken,
    work: Box<dyn FnOnce(&CancelToken) + Send + 'static>,
}

struct Inner {
    fg_queue: VecDeque<Job>,
    bg_queue: VecDeque<Job>,
}

struct Requests {
    /// Active job id → token, so `cancel(id)` can flip a job that has
    /// already been submitted.
    active: HashMap<u64, CancelToken>,
    /// Ids that were cancelled before their job reached `submit`.
    /// `submit` checks this set so a fast cancel-before-submit race
    /// still wins.
    pre_cancelled: HashSet<u64>,
}

pub struct TaskPool {
    state: Arc<(Mutex<Inner>, Condvar, Condvar)>, // (lock, fg_cv, bg_cv)
    requests: Arc<Mutex<Requests>>,
}

impl TaskPool {
    fn new() -> Arc<Self> {
        let state = Arc::new((
            Mutex::new(Inner {
                fg_queue: VecDeque::new(),
                bg_queue: VecDeque::new(),
            }),
            Condvar::new(),
            Condvar::new(),
        ));
        let requests = Arc::new(Mutex::new(Requests {
            active: HashMap::new(),
            pre_cancelled: HashSet::new(),
        }));
        let pool = Arc::new(Self { state, requests });

        let cpus = thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .max(2);
        // Reserve a couple of cores for the foreground (full-image
        // bytes / on-screen thumbnails) so a saturated background
        // pool can never delay them.
        let fg_workers = (cpus / 2).clamp(2, 4);
        let bg_workers = cpus.saturating_sub(fg_workers).max(1);

        for i in 0..fg_workers {
            let p = pool.clone();
            thread::Builder::new()
                .name(format!("warble-fg-{i}"))
                .spawn(move || p.run_fg())
                .expect("spawn foreground worker");
        }
        for i in 0..bg_workers {
            let p = pool.clone();
            thread::Builder::new()
                .name(format!("warble-bg-{i}"))
                .spawn(move || p.run_bg())
                .expect("spawn background worker");
        }
        pool
    }

    /// Submit a job for execution at the given priority.
    ///
    /// `request_id`, when present, lets the frontend cancel the job via
    /// [`Self::cancel`] before (or while) it runs. The job's closure
    /// receives a [`CancelToken`] it can poll between sub-steps.
    pub fn submit<F>(&self, priority: Priority, request_id: Option<u64>, work: F)
    where
        F: FnOnce(&CancelToken) + Send + 'static,
    {
        // Register the cancel token first so a cancel command racing
        // submission still finds it.
        let cancel = match request_id {
            Some(id) => {
                let mut r = self.requests.lock().unwrap();
                if r.pre_cancelled.remove(&id) {
                    let tok = CancelToken::pre_cancelled();
                    r.active.insert(id, tok.clone());
                    tok
                } else {
                    let tok = CancelToken::new();
                    r.active.insert(id, tok.clone());
                    tok
                }
            }
            None => CancelToken::new(),
        };

        let requests = self.requests.clone();
        let id = request_id;
        let work_box: Box<dyn FnOnce(&CancelToken) + Send + 'static> =
            Box::new(move |tok: &CancelToken| {
                work(tok);
                if let Some(id) = id {
                    requests.lock().unwrap().active.remove(&id);
                }
            });

        let job = Job {
            cancel,
            work: work_box,
        };

        let (lock, fg_cv, bg_cv) = &*self.state;
        let mut g = lock.lock().unwrap();
        match priority {
            Priority::Urgent => {
                g.fg_queue.push_front(job);
                fg_cv.notify_one();
            }
            Priority::Foreground => {
                g.fg_queue.push_back(job);
                fg_cv.notify_one();
            }
            Priority::Background => {
                g.bg_queue.push_back(job);
                bg_cv.notify_one();
            }
        }
    }

    /// Cancel a previously-submitted job by its `request_id`. If the
    /// job hasn't been submitted yet, the id is parked so it'll be
    /// cancelled on arrival.
    pub fn cancel(&self, request_id: u64) {
        let mut r = self.requests.lock().unwrap();
        if let Some(tok) = r.active.remove(&request_id) {
            tok.cancel();
        } else {
            r.pre_cancelled.insert(request_id);
            // Bound the pre-cancel set so a misbehaving caller can't
            // grow it without bound.
            if r.pre_cancelled.len() > 4096 {
                r.pre_cancelled.clear();
            }
        }
    }

    fn run_fg(&self) {
        let (lock, fg_cv, _bg_cv) = &*self.state;
        loop {
            let job = {
                let mut g = lock.lock().unwrap();
                loop {
                    if let Some(j) = g.fg_queue.pop_front() {
                        break j;
                    }
                    g = fg_cv.wait(g).unwrap();
                }
            };
            (job.work)(&job.cancel);
        }
    }

    fn run_bg(&self) {
        let (lock, _fg_cv, bg_cv) = &*self.state;
        loop {
            let job = {
                let mut g = lock.lock().unwrap();
                loop {
                    if let Some(j) = g.bg_queue.pop_front() {
                        break j;
                    }
                    g = bg_cv.wait(g).unwrap();
                }
            };
            (job.work)(&job.cancel);
        }
    }
}

/// Process-wide singleton.
pub fn pool() -> &'static Arc<TaskPool> {
    static P: OnceLock<Arc<TaskPool>> = OnceLock::new();
    P.get_or_init(TaskPool::new)
}

/// Convenience: submit `work` and `await` its result over a oneshot.
/// `work` returns a `Result<T, String>` matching the existing imaging
/// fns. If the job is cancelled before it starts, returns
/// `Err("cancelled")` without running `work`.
pub async fn run<F, T>(
    priority: Priority,
    request_id: Option<u64>,
    work: F,
) -> Result<T, String>
where
    F: FnOnce(&CancelToken) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    pool().submit(priority, request_id, move |cancel| {
        let result = if cancel.is_cancelled() {
            Err("cancelled".to_string())
        } else {
            work(cancel)
        };
        let _ = tx.send(result);
    });
    rx.await
        .map_err(|_| "task channel dropped".to_string())?
}
