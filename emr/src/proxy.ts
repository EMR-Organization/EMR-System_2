import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Convenience only: sends people with no session cookie to /login instead of
// showing them an error page. It is NOT the security check. A cookie being
// present proves nothing; every service re-checks the session in the database
// via requireUser(). (CVE-2025-29927 showed why middleware must never be the
// only guard.)

const PUBLIC_PATHS = ["/login", "/register", "/pending", "/reset", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's static files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
