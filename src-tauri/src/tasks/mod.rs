//! Small, bounded worker queue for blocking image operations.
//!
//! The currently viewed image can jump ahead of ordinary thumbnail and metadata
//! work. Requests are cancellable before or during processing so rapid
//! navigation does not waste time decoding images the user has left behind.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Urgent,
    High,
    Normal,
    Background,
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

    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("cancelled".to_string())
        } else {
            Ok(())
        }
    }
}

struct Job {
    priority: Priority,
    request_id: Option<u64>,
    cancel: CancelToken,
    work: Box<dyn FnOnce(&CancelToken) + Send + 'static>,
}

#[derive(Default)]
struct Requests {
    active: HashMap<u64, CancelToken>,
    priorities: HashMap<u64, Priority>,
    // A cancellation IPC message can reach Rust before its matching image
    // request. Keep that race harmless without retaining ids indefinitely.
    pre_cancelled: HashSet<u64>,
}

pub struct TaskPool {
    queue: Arc<(Mutex<VecDeque<Job>>, Condvar)>,
    requests: Arc<Mutex<Requests>>,
    worker_count: AtomicUsize,
    spawned_workers: Mutex<usize>,
}

pub struct RequestGuard {
    request_id: Option<u64>,
    token: CancelToken,
    requests: Arc<Mutex<Requests>>,
}

impl RequestGuard {
    pub fn token(&self) -> CancelToken {
        self.token.clone()
    }
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if let Some(id) = self.request_id {
            self.requests.lock().unwrap().active.remove(&id);
        }
    }
}

pub fn request_guard(request_id: Option<u64>) -> RequestGuard {
    let requests = Arc::clone(&pool().requests);
    let mut guard = requests.lock().unwrap();
    let token = if request_id.is_some_and(|id| guard.pre_cancelled.remove(&id)) {
        CancelToken::pre_cancelled()
    } else {
        CancelToken::new()
    };
    if let Some(id) = request_id {
        guard.active.insert(id, token.clone());
    }
    drop(guard);
    RequestGuard {
        request_id,
        token,
        requests,
    }
}

impl TaskPool {
    fn new() -> Arc<Self> {
        let pool = Arc::new(Self {
            queue: Arc::new((Mutex::new(VecDeque::new()), Condvar::new())),
            requests: Arc::new(Mutex::new(Requests::default())),
            worker_count: AtomicUsize::new(1),
            spawned_workers: Mutex::new(0),
        });

        pool.set_worker_count(crate::settings::default_parallel_workers());
        pool
    }

    pub fn set_worker_count(self: &Arc<Self>, count: usize) {
        let count = count.clamp(1, 16);
        let mut spawned = self.spawned_workers.lock().unwrap();
        let queue = self.queue.0.lock().unwrap();
        self.worker_count.store(count, Ordering::Release);
        for index in *spawned..count {
            let worker = Arc::clone(self);
            std::thread::spawn(move || worker.run(index));
        }
        *spawned = (*spawned).max(count);
        drop(queue);
        self.queue.1.notify_all();
    }

    pub fn submit<F>(&self, priority: Priority, request_id: Option<u64>, work: F)
    where
        F: FnOnce(&CancelToken) + Send + 'static,
    {
        let mut request_guard = self.requests.lock().unwrap();
        let cancel = match request_id {
            Some(id) => {
                let token = if request_guard.pre_cancelled.remove(&id) {
                    CancelToken::pre_cancelled()
                } else {
                    CancelToken::new()
                };
                request_guard.active.insert(id, token.clone());
                token
            }
            None => CancelToken::new(),
        };
        let priority = request_id
            .and_then(|id| request_guard.priorities.remove(&id))
            .unwrap_or(priority);

        let requests = Arc::clone(&self.requests);
        let job = Job {
            priority,
            request_id,
            cancel,
            work: Box::new(move |token| {
                work(token);
                if let Some(id) = request_id {
                    requests.lock().unwrap().active.remove(&id);
                }
            }),
        };

        let (lock, wake) = &*self.queue;
        let mut queue = lock.lock().unwrap();
        insert_job(&mut queue, job);
        drop(request_guard);
        wake.notify_all();
    }

    pub fn cancel(&self, request_id: u64) {
        let mut requests = self.requests.lock().unwrap();
        requests.priorities.remove(&request_id);
        if let Some(token) = requests.active.remove(&request_id) {
            token.cancel();
            self.queue.1.notify_all();
            return;
        }
        requests.pre_cancelled.insert(request_id);
        if requests.pre_cancelled.len() > 4096 {
            requests.pre_cancelled.clear();
        }
    }

    pub fn set_priority(&self, request_id: u64, priority: Priority) {
        let mut requests = self.requests.lock().unwrap();
        let (lock, wake) = &*self.queue;
        let mut queue = lock.lock().unwrap();
        let Some(index) = queue
            .iter()
            .position(|queued| queued.request_id == Some(request_id))
        else {
            if !requests.active.contains_key(&request_id) {
                requests.priorities.insert(request_id, priority);
                if requests.priorities.len() > 4096 {
                    requests.priorities.clear();
                }
            }
            return;
        };
        let Some(mut job) = queue.remove(index) else {
            return;
        };
        job.priority = priority;
        insert_job(&mut queue, job);
        wake.notify_all();
    }

    fn run(&self, worker_index: usize) {
        let (lock, wake) = &*self.queue;
        loop {
            let job = {
                let mut queue = lock.lock().unwrap();
                loop {
                    let worker_count = self.worker_count.load(Ordering::Acquire);
                    let interactive_only = worker_count > 1 && worker_index == 0;
                    if let Some(index) = queue.iter().position(|job| {
                        worker_index < worker_count
                            && (job.cancel.is_cancelled()
                                || !interactive_only
                                || job.priority <= Priority::High)
                    }) {
                        break queue.remove(index).unwrap();
                    }
                    queue = wake.wait(queue).unwrap();
                }
            };
            (job.work)(&job.cancel);
        }
    }
}

fn insert_job(queue: &mut VecDeque<Job>, job: Job) {
    let index = queue
        .iter()
        .position(|queued| queued.priority > job.priority)
        .unwrap_or(queue.len());
    queue.insert(index, job);
}

pub fn pool() -> &'static Arc<TaskPool> {
    static POOL: OnceLock<Arc<TaskPool>> = OnceLock::new();
    POOL.get_or_init(TaskPool::new)
}

pub async fn run<F, T>(priority: Priority, request_id: Option<u64>, work: F) -> Result<T, String>
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
    rx.await.map_err(|_| "task channel dropped".to_string())?
}
