#!/usr/bin/env node
// Shared tiny helpers for scripts/assert/*.mjs. No third-party deps.
export const API = (process.env.API_BASE || "http://127.0.0.1:3020/game/api").replace(/\/+$/, "");

export function fail(msg) {
  console.error(`[ASSERT] ${msg}`);
  process.exit(1);
}

export function ok(msg = "OK") {
  console.log(msg);
  process.exit(0);
}

export function assert(cond, msg) {
  if (!cond) fail(msg);
}

export function ac(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

export async function post(path, body, ms = 25000) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ac(ms),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

export async function get(path, ms = 15000) {
  const res = await fetch(`${API}${path}`, { signal: ac(ms) });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

export async function makeSave(tag) {
  const { status, body } = await post("/saves", {
    player_name: `assert-${tag}-${Date.now().toString(36)}`,
  });
  assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
  return body.save.id;
}
