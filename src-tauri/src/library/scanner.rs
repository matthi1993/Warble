use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;
use crate::library::{scan_folder_images, scan_root_tree, scan_subtree_tree, Folder, Photo};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ScanKind {
    FolderTree,
    FolderImages,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    phase: &'static str,
    kind: ScanKind,
    root_id: String,
    folder_key: String,
    job_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderUpdate {
    folders: Vec<Folder>,
    root_id: String,
    folder_key: String,
    content_changed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageUpdate {
    root_id: String,
    folder_key: String,
}

#[derive(Default)]
struct ScanQueue {
    jobs: VecDeque<ScanJob>,
    worker_running: bool,
    root_generations: HashMap<String, u64>,
    job_generations: HashMap<String, u64>,
    next_job_id: u64,
}

#[derive(Clone)]
struct ScanJob {
    job_id: u64,
    kind: ScanKind,
    root_id: String,
    folder_key: String,
    name: String,
    root_path: PathBuf,
    root_generation: u64,
    job_generation: u64,
    recursive: bool,
}

#[derive(Default)]
pub struct ScanCoordinator {
    queue: Mutex<ScanQueue>,
}

impl ScanCoordinator {
    pub fn enqueue_root(
        self: &Arc<Self>,
        app: &AppHandle,
        root_id: String,
        name: String,
        root_path: PathBuf,
    ) {
        let folder_key = root_id.clone();
        let (cancelled_jobs, job) = {
            let Ok(mut queue) = self.queue.lock() else {
                return;
            };
            let cancelled = remove_queued_root_jobs(&mut queue.jobs, &root_id);
            let root_generation = increment(&mut queue.root_generations, &root_id);
            let job_generation = next_job_generation(&mut queue, ScanKind::FolderTree, &folder_key);
            let job = new_job(
                &mut queue,
                ScanKind::FolderTree,
                root_id,
                folder_key,
                name,
                root_path,
                root_generation,
                job_generation,
                false,
            );
            queue.jobs.push_back(job.clone());
            (cancelled, job)
        };
        for cancelled_job in cancelled_jobs {
            emit_progress(app, progress(&cancelled_job, "cancelled", None));
            if cancelled_job.folder_key != job.folder_key {
                self.mark_folder_scanning(app, &cancelled_job.folder_key, false);
            }
        }
        self.start_worker(app, job);
    }

    pub fn enqueue_subtree(
        self: &Arc<Self>,
        app: &AppHandle,
        root_id: String,
        folder_key: String,
        name: String,
        root_path: PathBuf,
    ) {
        self.enqueue_job(
            app,
            ScanKind::FolderTree,
            root_id,
            folder_key,
            name,
            root_path,
            false,
        );
    }

    pub fn enqueue_images(
        self: &Arc<Self>,
        app: &AppHandle,
        root_id: String,
        folder_key: String,
        root_path: PathBuf,
        recursive: bool,
    ) {
        let name = folder_key
            .rsplit('/')
            .next()
            .unwrap_or(&folder_key)
            .to_string();
        self.enqueue_job(
            app,
            ScanKind::FolderImages,
            root_id,
            folder_key,
            name,
            root_path,
            recursive,
        );
    }

    pub fn remove_root(&self, app: &AppHandle, root_id: &str) {
        let cancelled_jobs = {
            let Ok(mut queue) = self.queue.lock() else {
                return;
            };
            increment(&mut queue.root_generations, root_id);
            remove_queued_root_jobs(&mut queue.jobs, root_id)
        };
        for job in cancelled_jobs {
            emit_progress(app, progress(&job, "cancelled", None));
        }
    }

    fn enqueue_job(
        self: &Arc<Self>,
        app: &AppHandle,
        kind: ScanKind,
        root_id: String,
        folder_key: String,
        name: String,
        root_path: PathBuf,
        recursive: bool,
    ) {
        let (cancelled_job, job) = {
            let Ok(mut queue) = self.queue.lock() else {
                return;
            };
            let cancelled = remove_queued_job(&mut queue.jobs, kind, &folder_key);
            let root_generation = *queue.root_generations.entry(root_id.clone()).or_default();
            let job_generation = next_job_generation(&mut queue, kind, &folder_key);
            let job = new_job(
                &mut queue,
                kind,
                root_id,
                folder_key,
                name,
                root_path,
                root_generation,
                job_generation,
                recursive,
            );
            queue.jobs.push_front(job.clone());
            if kind == ScanKind::FolderImages {
                if let Some(index) = queue.jobs.iter().position(|queued| {
                    queued.kind == ScanKind::FolderTree
                        && queued.root_id == job.root_id
                        && (queued.folder_key == job.folder_key
                            || job
                                .folder_key
                                .starts_with(&format!("{}/", queued.folder_key)))
                }) {
                    if let Some(tree_job) = queue.jobs.remove(index) {
                        queue.jobs.push_front(tree_job);
                    }
                }
            }
            (cancelled, job)
        };
        if let Some(job) = cancelled_job {
            emit_progress(app, progress(&job, "cancelled", None));
        }
        self.start_worker(app, job);
    }

    fn start_worker(self: &Arc<Self>, app: &AppHandle, job: ScanJob) {
        let start_worker = {
            let mut queue = match self.queue.lock() {
                Ok(queue) => queue,
                Err(_) => return,
            };
            let start_worker = !queue.worker_running;
            if start_worker {
                queue.worker_running = true;
            }
            start_worker
        };
        self.mark_folder_scanning(app, &job.folder_key, true);
        emit_progress(app, progress(&job, "queued", None));
        if start_worker {
            let coordinator = Arc::clone(self);
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || coordinator.run(app));
        }
    }

    fn run(self: Arc<Self>, app: AppHandle) {
        loop {
            let job = {
                let mut queue = match self.queue.lock() {
                    Ok(queue) => queue,
                    Err(_) => return,
                };
                match queue.jobs.pop_front() {
                    Some(job) => job,
                    None => {
                        queue.worker_running = false;
                        return;
                    }
                }
            };
            if self.is_current(&job) {
                emit_progress(&app, progress(&job, "scanning", None));
                match execute(&app, &self, &job) {
                    ScanOutcome::Done => emit_progress(&app, progress(&job, "done", None)),
                    ScanOutcome::Stale => emit_progress(&app, progress(&job, "cancelled", None)),
                    ScanOutcome::Error(message) => {
                        emit_progress(&app, progress(&job, "error", Some(message)))
                    }
                }
            } else {
                emit_progress(&app, progress(&job, "cancelled", None));
            }
            self.finish_job(&app, &job);
        }
    }

    fn is_current(&self, job: &ScanJob) -> bool {
        self.queue
            .lock()
            .map(|queue| is_current_in_queue(&queue, job))
            .unwrap_or(false)
    }

    fn finish_job(&self, app: &AppHandle, job: &ScanJob) {
        let queue = match self.queue.lock() {
            Ok(queue) => queue,
            Err(_) => return,
        };
        if queue
            .jobs
            .iter()
            .any(|queued| queued.folder_key == job.folder_key)
        {
            return;
        }
        let state = app.state::<AppState>();
        let folders = state.catalog.lock().ok().map(|mut catalog| {
            catalog.set_folder_scanning(&job.folder_key, false);
            catalog.roots()
        });
        if let Some(folders) = folders {
            emit_folders(app, folders, job, false);
        }
    }

    fn mark_folder_scanning(&self, app: &AppHandle, folder_key: &str, scanning: bool) {
        let state = app.state::<AppState>();
        let folders = state.catalog.lock().ok().map(|mut catalog| {
            catalog.set_folder_scanning(folder_key, scanning);
            catalog.roots()
        });
        if let Some(folders) = folders {
            let root_id = folder_key.split('/').next().unwrap_or(folder_key);
            let _ = app.emit(
                "folders-updated",
                FolderUpdate {
                    folders,
                    root_id: root_id.to_string(),
                    folder_key: folder_key.to_string(),
                    content_changed: false,
                },
            );
        }
    }

    fn merge_tree(&self, app: &AppHandle, job: &ScanJob, folder: Folder) -> ScanOutcome {
        let queue = match self.queue.lock() {
            Ok(queue) => queue,
            Err(error) => return ScanOutcome::Error(error.to_string()),
        };
        if !is_current_in_queue(&queue, job) {
            return ScanOutcome::Stale;
        }
        let still_queued = queue
            .jobs
            .iter()
            .any(|queued| queued.folder_key == job.folder_key);
        let state = app.state::<AppState>();
        let mut catalog = match state.catalog.lock() {
            Ok(catalog) => catalog,
            Err(error) => return ScanOutcome::Error(error.to_string()),
        };
        let result = if job.folder_key == job.root_id {
            catalog.merge_root_tree(folder);
            Ok(())
        } else {
            catalog.merge_subtree_tree(&job.folder_key, folder)
        };
        if let Err(message) = result {
            return ScanOutcome::Error(message);
        }
        catalog.set_folder_scanning(&job.folder_key, still_queued);
        emit_folders(app, catalog.roots(), job, true);
        ScanOutcome::Done
    }

    fn merge_images(
        &self,
        app: &AppHandle,
        job: &ScanJob,
        photos: HashMap<String, Photo>,
    ) -> ScanOutcome {
        let queue = match self.queue.lock() {
            Ok(queue) => queue,
            Err(error) => return ScanOutcome::Error(error.to_string()),
        };
        if !is_current_in_queue(&queue, job) {
            return ScanOutcome::Stale;
        }
        let state = app.state::<AppState>();
        let mut catalog = match state.catalog.lock() {
            Ok(catalog) => catalog,
            Err(error) => return ScanOutcome::Error(error.to_string()),
        };
        catalog.merge_folder_images(&job.folder_key, photos, job.recursive);
        let _ = app.emit(
            "folder-images-updated",
            ImageUpdate {
                root_id: job.root_id.clone(),
                folder_key: job.folder_key.clone(),
            },
        );
        ScanOutcome::Done
    }
}

enum ScanOutcome {
    Done,
    Stale,
    Error(String),
}

fn execute(app: &AppHandle, coordinator: &ScanCoordinator, job: &ScanJob) -> ScanOutcome {
    match job.kind {
        ScanKind::FolderTree => {
            let folder = if job.folder_key == job.root_id {
                scan_root_tree(&job.root_id, &job.name, &job.root_path)
            } else {
                scan_subtree_tree(&job.folder_key, &job.root_path)
            };
            match folder {
                Ok(folder) => coordinator.merge_tree(app, job, folder),
                Err(message) => ScanOutcome::Error(message),
            }
        }
        ScanKind::FolderImages => {
            let photos = match scan_folder_images(&job.folder_key, &job.root_path, job.recursive) {
                Ok(photos) => photos,
                Err(message) => return ScanOutcome::Error(message),
            };
            if !coordinator.is_current(job) {
                return ScanOutcome::Stale;
            }
            let keys = photos.keys().cloned().collect();
            match coordinator.merge_images(app, job, photos) {
                ScanOutcome::Done => {}
                outcome => return outcome,
            }

            // The UI can browse the discovered images now. Portable sidecar
            // hydration runs independently so switching folders never waits
            // behind metadata work from the previous folder.
            let sidecar_app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = sidecar_app.state::<AppState>();
                if let Ok(repo) = state.repository() {
                    crate::library::sync_portable_photo_keys(repo.as_ref(), &state, keys);
                }
            });
            ScanOutcome::Done
        }
    }
}

fn new_job(
    queue: &mut ScanQueue,
    kind: ScanKind,
    root_id: String,
    folder_key: String,
    name: String,
    root_path: PathBuf,
    root_generation: u64,
    job_generation: u64,
    recursive: bool,
) -> ScanJob {
    queue.next_job_id = queue.next_job_id.saturating_add(1);
    ScanJob {
        job_id: queue.next_job_id,
        kind,
        root_id,
        folder_key,
        name,
        root_path,
        root_generation,
        job_generation,
        recursive,
    }
}

fn next_job_generation(queue: &mut ScanQueue, kind: ScanKind, folder_key: &str) -> u64 {
    increment(
        &mut queue.job_generations,
        &generation_key(kind, folder_key),
    )
}

fn generation_key(kind: ScanKind, folder_key: &str) -> String {
    let prefix = match kind {
        ScanKind::FolderTree => "tree",
        ScanKind::FolderImages => "images",
    };
    format!("{prefix}:{folder_key}")
}

fn is_current_in_queue(queue: &ScanQueue, job: &ScanJob) -> bool {
    queue
        .root_generations
        .get(&job.root_id)
        .copied()
        .unwrap_or(0)
        == job.root_generation
        && queue
            .job_generations
            .get(&generation_key(job.kind, &job.folder_key))
            .copied()
            .unwrap_or(0)
            == job.job_generation
}

fn increment(generations: &mut HashMap<String, u64>, key: &str) -> u64 {
    let generation = generations.entry(key.to_string()).or_default();
    *generation = generation.saturating_add(1);
    *generation
}

fn remove_queued_root_jobs(jobs: &mut VecDeque<ScanJob>, root_id: &str) -> Vec<ScanJob> {
    let mut cancelled = Vec::new();
    jobs.retain(|job| {
        if job.root_id == root_id {
            cancelled.push(job.clone());
            false
        } else {
            true
        }
    });
    cancelled
}

fn remove_queued_job(
    jobs: &mut VecDeque<ScanJob>,
    kind: ScanKind,
    folder_key: &str,
) -> Option<ScanJob> {
    let index = jobs
        .iter()
        .position(|job| job.kind == kind && job.folder_key == folder_key)?;
    jobs.remove(index)
}

fn emit_progress(app: &AppHandle, progress: ScanProgress) {
    let _ = app.emit("folder-scan-progress", progress);
}

fn emit_folders(app: &AppHandle, folders: Vec<Folder>, job: &ScanJob, content_changed: bool) {
    let _ = app.emit(
        "folders-updated",
        FolderUpdate {
            folders,
            root_id: job.root_id.clone(),
            folder_key: job.folder_key.clone(),
            content_changed,
        },
    );
}

fn progress(job: &ScanJob, phase: &'static str, message: Option<String>) -> ScanProgress {
    ScanProgress {
        phase,
        kind: job.kind,
        root_id: job.root_id.clone(),
        folder_key: job.folder_key.clone(),
        job_id: job.job_id,
        message,
    }
}
