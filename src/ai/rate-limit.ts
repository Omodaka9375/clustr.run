/** Shared AI request rate limiter. */

const MAX_CONCURRENT = 3;
const COOLDOWN_MS = 1000;

let active = 0;
let lastRequest = 0;

/** Check if a new request is allowed. Returns an error message if not. */
export function canRequest(): string | null {
  if (active >= MAX_CONCURRENT)
    return "Too many requests in flight. Please wait.";
  const elapsed = Date.now() - lastRequest;
  if (elapsed < COOLDOWN_MS)
    return `Please wait ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s before requesting again.`;
  return null;
}

/** Mark a request as started. */
export function requestStarted(): void {
  active++;
  lastRequest = Date.now();
}

/** Mark a request as finished. */
export function requestEnded(): void {
  active = Math.max(0, active - 1);
}
