export interface WorkspaceBackend {
  getLastFolder(): Promise<string | null>;
  setLastFolder(path: string): Promise<void>;
  resetWorkspace(): Promise<void>;
}
