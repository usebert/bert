const inFlight = new Map<string, Promise<unknown>>();

export function requestDedupeKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

/** Same key returns the same in-flight promise until the first call settles. */
export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = run().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
    }
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearInFlightRequestDedupe(): void {
  inFlight.clear();
}
