import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TaskPriority, Unsubscribe } from "@warble/core";
import type { ClearedCache, ImageBackend } from "@warble/media";

export class TauriImageBackend implements ImageBackend {
  thumbnailBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>("get_thumbnail", { photoPath: path, requestId, priority });
  }

  hdImageBytes(path: string, requestId: number, priority: TaskPriority): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>("get_hd_image_bytes", { photoPath: path, requestId, priority });
  }

  fullImageBytes(path: string, requestId: number): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>("get_full_image_bytes", { photoPath: path, requestId });
  }

  cancelRequest(requestId: number): Promise<void> {
    return invoke("cancel_image_request", { requestId });
  }

  setRequestPriority(requestId: number, priority: TaskPriority): Promise<void> {
    return invoke("set_image_request_priority", { requestId, priority });
  }

  async videoSource(path: string): Promise<string> {
    return convertFileSrc(await invoke<string>("get_video_source", { photoPath: path }));
  }

  onCacheCleared(listener: (cache: ClearedCache) => void): Unsubscribe {
    const listening = listen<ClearedCache>("cache-cleared", (event) => listener(event.payload));
    return () => void listening.then((unlisten) => unlisten());
  }
}
