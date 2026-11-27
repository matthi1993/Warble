export interface VideoViewHost {
  readonly path: string | null;
  readonly presenting: boolean;
  readonly isConnected: boolean;
  requestUpdate(): void;
}
