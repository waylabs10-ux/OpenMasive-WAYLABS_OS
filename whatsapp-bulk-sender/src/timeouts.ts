const PAGE_ACTION_TIMEOUT_MS = 90_000;
const MAX_SEND_ATTEMPTS = 3;
const POST_SEND_COOLDOWN_MS = 2_000;

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

export { MAX_SEND_ATTEMPTS, PAGE_ACTION_TIMEOUT_MS, POST_SEND_COOLDOWN_MS };
