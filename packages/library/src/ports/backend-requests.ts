export interface BackendRequests {
  /** Ids must be unique across every consumer of the backend request queue. */
  nextRequestId(): number;
  cancelRequest(requestId: number): void;
}
