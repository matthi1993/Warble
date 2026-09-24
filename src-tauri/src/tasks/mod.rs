//! Small, bounded worker queue for blocking image operations.
//!
//! The currently viewed image can jump ahead of ordinary thumbnail and metadata
//! work. Requests are cancellable before or during processing so rapid
//! navigation does not waste time decoding images the user has left behind.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Priority {
    Urgent,
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
    // A cancellation IPC message can reach Rust before its matching image
    // request. Keep that race harmless without retaining ids indefinitely.
    pre_cancelled: HashSet<u64>,
}

pub struct TaskPool {
    queue: Arc<(Mutex<VecDeque<Job>>, Condvar)>,
    requests: Arc<Mutex<Requests>>,
}

impl TaskPool {
    fn new() -> Arc<Self> {
        let pool = Arc::new(Self {
            queue: Arc::new((Mutex::new(VecDeque::new()), Condvar::new())),
            requests: Arc::new(Mutex::new(Requests::default())),
        });

        // Two workers let the initial thumbnail and HD preview arrive together
        // on desktop. iPad stays serial to keep its memory and thermal use low.
        #[cfg(not(target_os = "ios"))]
        let worker_count = 2;
        #[cfg(target_os = "ios")]
        let worker_count = 1;

        for _ in 0..worker_count {
            let worker = Arc::clone(&pool);
            std::thread::spawn(move || worker.run());
        }
        pool
    }

    pub fn submit<F>(&self, priority: Priority, request_id: Option<u64>, work: F)
    where
        F: FnOnce(&CancelToken) + Send + 'static,
    {
        let cancel = match request_id {
            Some(id) => {
                let mut requests = self.requests.lock().unwrap();
                let token = if requests.pre_cancelled.remove(&id) {
                    CancelToken::pre_cancelled()
                } else {
                    CancelToken::new()
                };
                requests.active.insert(id, token.clone());
                token
            }
            None => CancelToken::new(),
        };

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
        match priority {
            Priority::Urgent => queue.push_front(job),
            Priority::Normal => {
                let index = queue
                    .iter()
                    .position(|queued| queued.priority == Priority::Background)
                    .unwrap_or(queue.len());
                queue.insert(index, job);
            }
            Priority::Background => queue.push_back(job),
        }
        wake.notify_one();
    }

    pub fn cancel(&self, request_id: u64) {
        let mut requests = self.requests.lock().unwrap();
        if let Some(token) = requests.active.remove(&request_id) {
            token.cancel();
            return;
        }
        requests.pre_cancelled.insert(request_id);
        if requests.pre_cancelled.len() > 4096 {
            requests.pre_cancelled.clear();
        }
    }

    pub fn promote(&self, request_id: u64, priority: Priority) {
        let (lock, wake) = &*self.queue;
        let mut queue = lock.lock().unwrap();
        let Some(index) = queue
            .iter()
            .position(|queued| queued.request_id == Some(request_id))
        else {
            return;
        };
        let Some(mut job) = queue.remove(index) else {
            return;
        };
        job.priority = priority;
        match priority {
            Priority::Urgent => queue.push_front(job),
            Priority::Normal => {
                let index = queue
                    .iter()
                    .position(|queued| queued.priority == Priority::Background)
                    .unwrap_or(queue.len());
                queue.insert(index, job);
            }
            Priority::Background => queue.push_back(job),
        }
        wake.notify_one();
    }

    fn run(&self) {
        let (lock, wake) = &*self.queue;
        loop {
            let job = {
                let mut queue = lock.lock().unwrap();
                loop {
                    if let Some(job) = queue.pop_front() {
                        break job;
                    }
                    queue = wake.wait(queue).unwrap();
                }
            };
            (job.work)(&job.cancel);
        }
    }
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
