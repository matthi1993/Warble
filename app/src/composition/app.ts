import { TauriPlatform } from "../platform/tauri-platform";
import { AppContext } from "./app-context";

export const app = new AppContext(new TauriPlatform());
