//! Priority task pool used by the image commands so the photo the user
//! is currently looking at always wins over background work like
//! folder-wide thumbnail batches and neighbour prefetching.
//!
//! Two dedicated worker lanes:
//!
//! * **Foreground** workers drain `Urgent` and `Foreground` jobs.
//!   `Urgent` jumps the queue (push_front) so a navigation away from
//!   the active photo can re-task the foreground pool immediately.
//!   These workers never pick up `Background` jobs, so a slow RAW
//!   thumbnail can never block the next full-resolution decode.
//!
//! * **Background** workers drain `Nearby` before `Background` jobs.
//!   Nearby work prepares the photos beside the active photo; ordinary
//!   background work covers folder-wide thumbnail and metadata batches.
//!   Both stay off the latency-sensitive foreground workers.
//!
//! Each submitted job gets an optional `request_id` so the frontend
//! can flip its [`CancelToken`]. Workers check the flag before
//! starting work; long-running tasks can also poll cooperatively.
//! Jobs that arrive already-cancelled are skipped without running.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use serde::Serialize;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Priority {
    /// Block on the foreground pool, jumping ahead of queued Foreground
    /// jobs. Use for the photo the user is actively viewing.
    Urgent,
    /// Foreground pool, FIFO. Use for visible-but-not-active UI like
    /// thumbnail cards in the current viewport.
    Foreground,
    /// Background lane, ahead of folder-wide work. Use for the next
    /// photos a user is likely to swipe to from the full viewer.
    Nearby,
    /// Background pool. Use for prefetch and folder-wide batches.
    Background,
}

impl Priority {
    pub fn parse(s: Option<&str>) -> Self {
        match s.unwrap_or("") {
            "urgent" => Priority::Urgent,
            "nearby" => Priority::Nearby,
            "background" => Priority::Background,
            // Default to foreground so older invocations stay snappy.
            _ => Priority::Foreground,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Priority::Urgent => "urgent",
            Priority::Foreground => "foreground",
            Priority::Nearby => "nearby",
            Priority::Background => "background",
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
    /// Convenience for cooperative bail-out: returns `Err("cancelled")`
    /// when the flag is set, `Ok(())` otherwise.
    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("cancelled".to_string())
        } else {
            Ok(())
        }
    }
}

struct JobMeta {
    job_id: u64,
    label: &'static str,
    priority: Priority,
    submitted_at: Instant,
}

struct Job {
    meta: JobMeta,
    cancel: CancelToken,
    work: Box<dyn FnOnce(&CancelToken) + Send + 'static>,
}

struct Inner {
    fg_queue: VecDeque<Job>,
    nearby_queue: VecDeque<Job>,
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

/// Per-job snapshot row used by the debug overlay.
#[derive(Clone, Debug, Serialize)]
pub struct JobSnapshot {
    pub job_id: u64,
    pub label: &'static str,
    pub priority: &'static str,
    /// Milliseconds the job has spent in its current state (queued or
    /// running). Computed at snapshot time.
    pub age_ms: u64,
    /// `true` once a worker has popped the job and started running it.
    pub running: bool,
    /// `true` if the job's cancel flag was flipped.
    pub cancelled: bool,
}

/// A finished job kept in the ring buffer so the debug overlay can
/// show recent timings (queue + run latency) and cancellations.
#[derive(Clone, Debug, Serialize)]
pub struct FinishedJob {
    pub job_id: u64,
    pub label: &'static str,
    pub priority: &'static str,
    /// Milliseconds the job spent waiting in the queue before a worker
    /// picked it up.
    pub queued_ms: u64,
    /// Milliseconds the worker spent actually executing the job.
    pub run_ms: u64,
    /// `true` if the cancel flag was set at any point during the job's
    /// lifetime (queued or running).
    pub cancelled: bool,
}

/// Maximum number of recently-finished jobs retained for the debug
/// overlay. Bounded so a long-running session can't grow the buffer
/// without limit.
const HISTORY_CAPACITY: usize = 256;

#[derive(Clone, Debug, Serialize)]
pub struct PoolStats {
    pub fg_workers: usize,
    pub bg_workers: usize,
    pub fg_queued: usize,
    pub nearby_queued: usize,
    pub bg_queued: usize,
    pub fg_running: usize,
    pub nearby_running: usize,
    pub bg_running: usize,
    pub total_submitted: u64,
    pub total_completed: u64,
    pub total_cancelled: u64,
    /// All jobs currently in the system (queued + running), most
    /// recent submission first.
    pub jobs: Vec<JobSnapshot>,
    /// Recently finished jobs, most-recent-first. Capped at
    /// [`HISTORY_CAPACITY`] entries.
    pub recent: Vec<FinishedJob>,
}

/// Tracks a job a worker is actively executing.
struct RunningJob {
    label: &'static str,
    priority: Priority,
    started_at: Instant,
    cancel: CancelToken,
}

struct Counters {
    next_job_id: AtomicU64,
    submitted: AtomicU64,
    completed: AtomicU64,
    cancelled: AtomicU64,
    fg_workers: AtomicU64,
    bg_workers: AtomicU64,
}

pub struct TaskPool {
    state: Arc<(Mutex<Inner>, Condvar, Condvar)>, // (lock, fg_cv, bg_cv)
    requests: Arc<Mutex<Requests>>,
    running: Arc<Mutex<HashMap<u64, RunningJob>>>,
    /// Ring buffer of finished jobs (most recent at the back).
    history: Arc<Mutex<VecDeque<FinishedJob>>>,
    counters: Arc<Counters>,
    /// Maximum number of `Background`-priority jobs allowed to run
    /// concurrently. The number of background OS threads spawned at
    /// startup is `bg_thread_capacity`; this value caps how many of
    /// them are permitted to be executing a job at any one time.
    bg_concurrency: AtomicUsize,
    /// Number of background jobs currently running. Compared against
    /// `bg_concurrency` by `run_bg` to throttle parallelism without
    /// having to spawn / join threads at runtime.
    bg_active: AtomicUsize,
    /// Total number of background OS threads spawned. Acts as the
    /// upper bound for `bg_concurrency` — setting the limit higher
    /// than this is silently clamped.
    bg_thread_capacity: AtomicUsize,
}

impl TaskPool {
    fn new() -> Arc<Self> {
        let state = Arc::new((
            Mutex::new(Inner {
                fg_queue: VecDeque::new(),
                nearby_queue: VecDeque::new(),
                bg_queue: VecDeque::new(),
            }),
            Condvar::new(),
            Condvar::new(),
        ));
        let requests = Arc::new(Mutex::new(Requests {
            active: HashMap::new(),
            pre_cancelled: HashSet::new(),
        }));
        let counters = Arc::new(Counters {
            next_job_id: AtomicU64::new(1),
            submitted: AtomicU64::new(0),
            completed: AtomicU64::new(0),
            cancelled: AtomicU64::new(0),
            fg_workers: AtomicU64::new(0),
            bg_workers: AtomicU64::new(0),
        });
        let running = Arc::new(Mutex::new(HashMap::new()));
        let history = Arc::new(Mutex::new(VecDeque::with_capacity(HISTORY_CAPACITY)));

        #[cfg(not(target_os = "ios"))]
        let cpus = thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .max(2);
        // Reserve a couple of cores for the foreground (full-image
        // bytes / on-screen thumbnails) so a saturated background
        // pool can never delay them.
        #[cfg(not(target_os = "ios"))]
        let fg_workers = (cpus / 2).clamp(2, 4);
        // iPad has a much tighter memory/thermal budget. One foreground
        // worker still keeps active-photo requests responsive without
        // allowing several large image decodes to peak at once.
        #[cfg(target_os = "ios")]
        let fg_workers = 1;
        // Spawn a generous upper bound of background OS threads at
        // startup so concurrency can be raised at runtime via
        // `set_bg_concurrency` without having to spawn more. Idle
        // threads just sleep on the bg condvar (cheap), so it's fine
        // to park more than we'll typically use.
        #[cfg(not(target_os = "ios"))]
        let bg_thread_capacity = (cpus * 2).max(8).min(16);
        #[cfg(target_os = "ios")]
        let bg_thread_capacity = 2;
        #[cfg(not(target_os = "ios"))]
        let default_bg_concurrency = cpus.saturating_sub(1).max(2).min(bg_thread_capacity);
        #[cfg(target_os = "ios")]
        let default_bg_concurrency = 1;

        let pool = Arc::new(Self {
            state,
            requests,
            running,
            history,
            counters,
            bg_concurrency: AtomicUsize::new(default_bg_concurrency),
            bg_active: AtomicUsize::new(0),
            bg_thread_capacity: AtomicUsize::new(bg_thread_capacity),
        });

        pool.counters
            .fg_workers
            .store(fg_workers as u64, Ordering::Relaxed);
        pool.counters
            .bg_workers
            .store(default_bg_concurrency as u64, Ordering::Relaxed);

        for i in 0..fg_workers {
            let p = pool.clone();
            thread::Builder::new()
                .name(format!("warble-fg-{i}"))
                .spawn(move || p.run_fg())
                .expect("spawn foreground worker");
        }
        for i in 0..bg_thread_capacity {
            let p = pool.clone();
            thread::Builder::new()
                .name(format!("warble-bg-{i}"))
                .spawn(move || p.run_bg())
                .expect("spawn background worker");
        }
        pool
    }

    /// Update the runtime cap on concurrent background jobs. Clamped
    /// to `[1, bg_thread_capacity]`. Wakes all parked background
    /// workers so any newly-permitted slots can be filled
    /// immediately.
    pub fn set_bg_concurrency(&self, n: usize) {
        let cap = self.bg_thread_capacity.load(Ordering::Relaxed).max(1);
        let clamped = n.clamp(1, cap);
        self.bg_concurrency.store(clamped, Ordering::Relaxed);
        self.counters
            .bg_workers
            .store(clamped as u64, Ordering::Relaxed);
        let (_, _, bg_cv) = &*self.state;
        bg_cv.notify_all();
    }

    /// Maximum number of background OS threads — i.e. the upper
    /// bound `set_bg_concurrency` will accept.
    pub fn bg_thread_capacity(&self) -> usize {
        self.bg_thread_capacity.load(Ordering::Relaxed)
    }

    /// Submit a job for execution at the given priority.
    ///
    /// `request_id`, when present, lets the frontend cancel the job via
    /// [`Self::cancel`] before (or while) it runs. The job's closure
    /// receives a [`CancelToken`] it can poll between sub-steps.
    pub fn submit<F>(
        &self,
        priority: Priority,
        request_id: Option<u64>,
        label: &'static str,
        work: F,
    ) where
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

        let job_id = self.counters.next_job_id.fetch_add(1, Ordering::Relaxed);
        self.counters.submitted.fetch_add(1, Ordering::Relaxed);
        let meta = JobMeta {
            job_id,
            label,
            priority,
            submitted_at: Instant::now(),
        };
        let job = Job {
            meta,
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
            Priority::Nearby => {
                g.nearby_queue.push_back(job);
                bg_cv.notify_one();
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
            self.counters.cancelled.fetch_add(1, Ordering::Relaxed);
        } else {
            r.pre_cancelled.insert(request_id);
            // Bound the pre-cancel set so a misbehaving caller can't
            // grow it without bound.
            if r.pre_cancelled.len() > 4096 {
                r.pre_cancelled.clear();
            }
        }
    }

    /// Cancel every job currently tracked by the pool — both queued
    /// and running. Each affected `CancelToken` is flipped, so the
    /// next cooperative checkpoint in the worker bails out. Workers
    /// then drain the rest of their queues normally; the cancelled
    /// jobs are skipped via the `is_cancelled` guard at the top of
    /// `run`. Returns the number of tokens we flipped.
    pub fn cancel_all(&self) -> usize {
        let mut count = 0usize;
        // Grab the queue lock first so a racing `submit` either
        // arrives before us (and gets cancelled) or after (and is
        // never seen). Then walk active request tokens too.
        {
            let (lock, _, _) = &*self.state;
            let g = lock.lock().unwrap();
            for j in g
                .fg_queue
                .iter()
                .chain(g.nearby_queue.iter())
                .chain(g.bg_queue.iter())
            {
                if !j.cancel.is_cancelled() {
                    j.cancel.cancel();
                    count += 1;
                }
            }
        }
        let mut r = self.requests.lock().unwrap();
        for (_, tok) in r.active.drain() {
            if !tok.is_cancelled() {
                tok.cancel();
                count += 1;
            }
        }
        // Also block any in-flight submits from racing past us.
        r.pre_cancelled.clear();
        if count > 0 {
            self.counters
                .cancelled
                .fetch_add(count as u64, Ordering::Relaxed);
        }
        count
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
            self.execute(job);
        }
    }

    fn run_bg(&self) {
        let (lock, _fg_cv, bg_cv) = &*self.state;
        loop {
            let job = {
                let mut g = lock.lock().unwrap();
                loop {
                    let limit = self.bg_concurrency.load(Ordering::Relaxed);
                    let active = self.bg_active.load(Ordering::Relaxed);
                    if active < limit {
                        if let Some(j) = g.nearby_queue.pop_front() {
                            // Increment while holding the queue lock. Otherwise
                            // two workers can both observe the same free final
                            // slot before either increments the atomic counter.
                            self.bg_active.fetch_add(1, Ordering::Relaxed);
                            break j;
                        }
                        if let Some(j) = g.bg_queue.pop_front() {
                            self.bg_active.fetch_add(1, Ordering::Relaxed);
                            break j;
                        }
                    }
                    g = bg_cv.wait(g).unwrap();
                }
            };
            self.execute(job);
            self.bg_active.fetch_sub(1, Ordering::Relaxed);
            // A concurrency slot just opened up — wake the next
            // parked worker so a queued job can start immediately.
            bg_cv.notify_one();
        }
    }

    fn execute(&self, job: Job) {
        let job_id = job.meta.job_id;
        let label = job.meta.label;
        let priority = job.meta.priority;
        let submitted_at = job.meta.submitted_at;
        let started_at = Instant::now();
        let running_entry = RunningJob {
            label,
            priority,
            started_at,
            cancel: job.cancel.clone(),
        };
        if let Ok(mut r) = self.running.lock() {
            r.insert(job_id, running_entry);
        }
        (job.work)(&job.cancel);
        let finished_at = Instant::now();
        if let Ok(mut r) = self.running.lock() {
            r.remove(&job_id);
        }
        self.counters.completed.fetch_add(1, Ordering::Relaxed);

        let entry = FinishedJob {
            job_id,
            label,
            priority: priority.as_str(),
            queued_ms: started_at
                .saturating_duration_since(submitted_at)
                .as_millis() as u64,
            run_ms: finished_at
                .saturating_duration_since(started_at)
                .as_millis() as u64,
            cancelled: job.cancel.is_cancelled(),
        };
        if let Ok(mut h) = self.history.lock() {
            if h.len() == HISTORY_CAPACITY {
                h.pop_front();
            }
            h.push_back(entry);
        }
    }

    /// Snapshot of pool state for the debug overlay. Cheap enough to
    /// poll at ~10 Hz: takes the queue lock briefly to copy metadata,
    /// then the running-jobs lock.
    pub fn snapshot(&self) -> PoolStats {
        let now = Instant::now();
        let mut jobs: Vec<JobSnapshot> = Vec::new();

        let (fg_queued, nearby_queued, bg_queued) = {
            let (lock, _, _) = &*self.state;
            let g = lock.lock().unwrap();
            for j in g
                .fg_queue
                .iter()
                .chain(g.nearby_queue.iter())
                .chain(g.bg_queue.iter())
            {
                jobs.push(JobSnapshot {
                    job_id: j.meta.job_id,
                    label: j.meta.label,
                    priority: j.meta.priority.as_str(),
                    age_ms: now
                        .saturating_duration_since(j.meta.submitted_at)
                        .as_millis() as u64,
                    running: false,
                    cancelled: j.cancel.is_cancelled(),
                });
            }
            (g.fg_queue.len(), g.nearby_queue.len(), g.bg_queue.len())
        };

        let (fg_running, nearby_running, bg_running) = {
            let r = self.running.lock().unwrap();
            let mut fg = 0usize;
            let mut nearby = 0usize;
            let mut bg = 0usize;
            for (id, entry) in r.iter() {
                match entry.priority {
                    Priority::Background => bg += 1,
                    Priority::Nearby => nearby += 1,
                    Priority::Urgent | Priority::Foreground => fg += 1,
                }
                jobs.push(JobSnapshot {
                    job_id: *id,
                    label: entry.label,
                    priority: entry.priority.as_str(),
                    age_ms: now.saturating_duration_since(entry.started_at).as_millis() as u64,
                    running: true,
                    cancelled: entry.cancel.is_cancelled(),
                });
            }
            (fg, nearby, bg)
        };

        // Most recent first (highest job_id at the top).
        jobs.sort_by(|a, b| b.job_id.cmp(&a.job_id));

        // Snapshot the finished-jobs ring buffer, most recent first.
        let recent: Vec<FinishedJob> = self
            .history
            .lock()
            .map(|h| h.iter().rev().cloned().collect())
            .unwrap_or_default();

        PoolStats {
            fg_workers: self.counters.fg_workers.load(Ordering::Relaxed) as usize,
            bg_workers: self.counters.bg_workers.load(Ordering::Relaxed) as usize,
            fg_queued,
            nearby_queued,
            bg_queued,
            fg_running,
            nearby_running,
            bg_running,
            total_submitted: self.counters.submitted.load(Ordering::Relaxed),
            total_completed: self.counters.completed.load(Ordering::Relaxed),
            total_cancelled: self.counters.cancelled.load(Ordering::Relaxed),
            jobs,
            recent,
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
    label: &'static str,
    work: F,
) -> Result<T, String>
where
    F: FnOnce(&CancelToken) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    pool().submit(priority, request_id, label, move |cancel| {
        let result = if cancel.is_cancelled() {
            Err("cancelled".to_string())
        } else {
            work(cancel)
        };
        let _ = tx.send(result);
    });
    rx.await.map_err(|_| "task channel dropped".to_string())?
}
