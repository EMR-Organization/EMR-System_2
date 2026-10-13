import "server-only";

// Errors services throw. Server actions turn them into a safe result with
// toActionResult(); anything else becomes a generic message, so stack traces
// and internal details never reach the browser.

export type ErrorCode = "AUTH" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMIT" | "INTERNAL";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    /** A message key under "Errors" in messages/en.json, safe to show the user. */
    readonly messageKey: string,
    message?: string,
  ) {
    super(message ?? messageKey);
    this.name = new.target.name;
  }
}

/** Not signed in, or the session expired or was revoked. */
export class AuthError extends AppError {
  constructor(message?: string) {
    super("AUTH", "signedOut", message);
  }
}

/** Signed in, but not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message?: string, messageKey = "forbidden") {
    super("FORBIDDEN", messageKey, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message?: string) {
    super("NOT_FOUND", "notFound", message);
  }
}

export class ValidationError extends AppError {
  constructor(
    readonly fieldErrors: Record<string, string[]> = {},
    messageKey = "validation",
  ) {
    super("VALIDATION", messageKey);
  }
}

/** Someone else saved the record first (optimistic locking). */
export class ConflictError extends AppError {
  constructor(message?: string, messageKey = "conflict") {
    super("CONFLICT", messageKey, message);
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super("RATE_LIMIT", "rateLimited");
  }
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; messageKey: string; fieldErrors?: Record<string, string[]> };

/**
 * Runs a service call for a server action and converts thrown errors into a
 * serializable result. Unexpected errors are logged on the server only.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, code: err.code, messageKey: err.messageKey, fieldErrors: err.fieldErrors };
    }
    if (err instanceof AppError) {
      return { ok: false, code: err.code, messageKey: err.messageKey };
    }
    if (isNextControlFlow(err)) throw err;
    console.error("Unexpected error in server action", err);
    return { ok: false, code: "INTERNAL", messageKey: "internal" };
  }
}

// redirect() and notFound() work by throwing; they must pass through untouched.
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR"));
}
