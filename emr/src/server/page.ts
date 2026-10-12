import "server-only";
import { notFound, redirect } from "next/navigation";
import { AuthError, ForbiddenError, NotFoundError } from "@/server/errors";

/**
 * For server components: runs service calls and turns the expected failures
 * into navigation:
 * - session ended -> /login
 * - not allowed, or doesn't exist -> the 404 page. The two look the same on
 *   purpose, so a page never confirms that a record exists to someone who
 *   can't see it.
 * Anything else still goes to the nearest error boundary.
 */
export async function orSignIn<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    if (err instanceof ForbiddenError || err instanceof NotFoundError) notFound();
    throw err;
  }
}
