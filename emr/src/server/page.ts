import "server-only";
import { redirect } from "next/navigation";
import { AuthError } from "@/server/errors";

/**
 * For server components: runs a service call and sends the user to /login if
 * their session has ended (rather than showing an error page). Any other error,
 * including ForbiddenError, still goes to the nearest error boundary.
 */
export async function orSignIn<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }
}
