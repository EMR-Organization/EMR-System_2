// A fake browser for service tests: stands in for next/headers so services see
// a request with cookies, an IP and a user agent. Cookies Better Auth sets on
// sign-in land in the jar and are sent back on the next "request", like a browser.

type CookieOptions = { maxAge?: number; expires?: Date | number };

const state = {
  jar: new Map<string, string>(),
  ip: "10.0.0.1",
  userAgent: "vitest",
};

export const browser = {
  /** Start a fresh browser: no cookies. */
  reset(ip = "10.0.0.1") {
    state.jar.clear();
    state.ip = ip;
  },
  cookies: () => new Map(state.jar),
  /** Swap the whole cookie jar (e.g. to act as a second device). */
  useCookies(jar: Map<string, string>) {
    state.jar = new Map(jar);
  },
  setIp(ip: string) {
    state.ip = ip;
  },
};

function buildHeaders(): Headers {
  const h = new Headers({ "user-agent": state.userAgent, "x-forwarded-for": state.ip, host: "localhost:3000" });
  if (state.jar.size > 0) {
    h.set("cookie", [...state.jar].map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return h;
}

export async function headers() {
  return buildHeaders();
}

export async function cookies() {
  return {
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => state.jar.has(name),
    set(nameOrCookie: string | ({ name: string; value: string } & CookieOptions), value?: string, opts?: CookieOptions) {
      const c = typeof nameOrCookie === "string" ? { name: nameOrCookie, value: value ?? "", ...opts } : nameOrCookie;
      const expired =
        c.maxAge === 0 || (c.maxAge !== undefined && c.maxAge < 0) || (c.expires !== undefined && new Date(c.expires).getTime() <= Date.now());
      if (expired || c.value === "") state.jar.delete(c.name);
      else state.jar.set(c.name, c.value);
    },
    delete: (name: string) => state.jar.delete(name),
  };
}
