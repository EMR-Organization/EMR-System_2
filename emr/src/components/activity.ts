"use client";

import { touchSessionAction } from "@/app/(app)/actions";

// Tracks when the person last actually used this device (tapped, typed,
// scrolled). The server's 30-minute idle timeout counts *requests*, so:
//
// - Background requests (list auto-refresh) must stop when nobody is there,
//   or they'd keep the session alive forever. AutoRefresh asks isActive().
// - Someone typing a long note makes no requests, so real input pings the
//   server now and then to keep a genuinely busy session alive.

const PING_EVERY_MS = 5 * 60 * 1000;

let lastInput = Date.now();
let lastPing = Date.now();
let listening = false;

function onInput() {
  const now = Date.now();
  lastInput = now;
  if (now - lastPing > PING_EVERY_MS) {
    lastPing = now;
    void touchSessionAction();
  }
}

/** Starts listening for input (idempotent). Called by the app shell. */
export function startActivityTracking() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  for (const event of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(event, onInput, { passive: true, capture: true });
  }
}

/** Milliseconds since the last real input on this device. */
export function idleMs(): number {
  return Date.now() - lastInput;
}

/** Whether someone used the device within the window (default 2 minutes). */
export function isActive(withinMs = 2 * 60 * 1000): boolean {
  return idleMs() < withinMs;
}

/** A request the person caused (e.g. a navigation) also counts as server activity. */
export function noteServerActivity() {
  lastPing = Date.now();
}
