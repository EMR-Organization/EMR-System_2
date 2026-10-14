import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/shared/csp";

// Two jobs, neither of them the security check for data:
//  1. Content-Security-Policy with a fresh nonce per request. Next reads the
//     nonce from the request's CSP header and puts it on its own scripts, so
//     the browser runs those and nothing else (no injected <script>, no
//     inline event handlers, no scripts from anywhere but this hub).
//  2. Sends people with no session cookie to /login instead of showing them an
//     error page. A cookie being present proves nothing; every service
//     re-checks the session in the database via requireUser(). (CVE-2025-29927
//     showed why middleware must never be the only guard.)

const PUBLIC_PATHS = ["/login", "/register", "/pending", "/reset", "/setup"];

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let response: NextResponse;
  if (!isPublic && !getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    response = NextResponse.redirect(login);
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("content-security-policy", csp);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except Next's static files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
