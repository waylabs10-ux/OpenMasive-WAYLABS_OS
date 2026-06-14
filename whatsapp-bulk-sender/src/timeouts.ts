const PAGE_ACTION_TIMEOUT_MS = 45_000;

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label}: tiempo agotado (${ms / 1000}s)`)),
        ms
      );
    }),
  ]);
}

export { PAGE_ACTION_TIMEOUT_MS };
