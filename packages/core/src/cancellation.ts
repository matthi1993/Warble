export function isCancellation(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = String((error as { message?: string } | null)?.message ?? error).toLowerCase();
  return message.includes("cancelled") || message.includes("aborted");
}
