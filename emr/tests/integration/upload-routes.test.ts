import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("./fake-request"));
vi.mock("next/headers.js", () => import("./fake-request"));

import { POST as uploadPhoto } from "@/app/api/patients/[patientId]/photos/route";
import { POST as importSync } from "@/app/api/sync/import/route";
import { POST as importTrip } from "@/app/api/trips/[tripId]/import/route";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { signIn } from "@/server/services/users";
import { browser } from "./fake-request";
import { createTrip, createUser } from "./fixtures";

// The upload routes accept big bodies (sync bundles up to 200 MB). Who's asking
// must be checked BEFORE the body is read, or any device on the network could
// make the hub buffer gigabytes and run out of memory.

beforeEach(() => {
  browser.reset();
  resetRateLimits();
});

/** A same-origin upload whose body records whether anyone started reading it. */
function upload(url: string) {
  const state = { read: false };
  const body = new ReadableStream({
    pull(controller) {
      state.read = true;
      controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
      controller.close();
    },
  }, { highWaterMark: 0 }); // pull only when someone actually reads
  const request = new Request(url, {
    method: "POST",
    body,
    duplex: "half",
    headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-length": String(1024 * 1024), "content-type": "multipart/form-data; boundary=x" },
  } as RequestInit);
  return { request, state };
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

describe("upload routes check the caller before reading the body", () => {
  it("signed out: 401 and nothing read", async () => {
    for (const [handler, path, params] of [
      [importSync, "/api/sync/import", {}],
      [importTrip, `/api/trips/${randomUUID()}/import`, { tripId: randomUUID() }],
      [uploadPhoto, `/api/patients/${randomUUID()}/photos`, { patientId: randomUUID() }],
    ] as const) {
      const { request, state } = upload(`http://localhost:3000${path}`);
      const response = await (handler as (r: Request, c: never) => Promise<Response>)(request, ctx(params));
      expect(response.status, path).toBe(401);
      expect(state.read, path).toBe(false);
    }
  });

  it("signed in without the permission: 403 and nothing read", async () => {
    const trip = await createTrip();
    const doctor = await createUser();
    await signIn({ email: doctor.email, password: doctor.password });

    const sync = upload("http://localhost:3000/api/sync/import");
    expect((await importSync(sync.request)).status).toBe(403);
    expect(sync.state.read).toBe(false);

    const tripImport = upload(`http://localhost:3000/api/trips/${trip.id}/import`);
    expect((await importTrip(tripImport.request, ctx({ tripId: trip.id }))).status).toBe(403);
    expect(tripImport.state.read).toBe(false);
  });
});
