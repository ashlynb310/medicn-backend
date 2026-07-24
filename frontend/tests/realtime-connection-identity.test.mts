// Behavioural checks for the OPAQUE realtime connection identity.
//
// A connection is (access token, inquiry room). Its identity must be an opaque
// object — never the token — and a status recorded for a previous generation
// must immediately resolve to a non-live "connecting" state during render.
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createConnectionGeneration,
  resolveRealtimeStatus,
} from "../src/lib/realtime/connection-identity.ts";

// Mirrors the hook's `useMemo(createConnectionGeneration, [accessToken, inquiryId])`:
// a new generation is minted only when the dependency identity changes.
function makeConnectionMemo() {
  let deps = null;
  let generation = null;
  return function next(accessToken, inquiryId) {
    if (
      deps === null ||
      deps.accessToken !== accessToken ||
      deps.inquiryId !== inquiryId
    ) {
      deps = { accessToken, inquiryId };
      generation = createConnectionGeneration();
    }
    return generation;
  };
}

// --- opaque generation ---

test("each generation is a distinct opaque object carrying no data", () => {
  const a = createConnectionGeneration();
  const b = createConnectionGeneration();
  assert.notEqual(a, b, "generations must be distinct identities");
  assert.deepEqual(Object.keys(a), [], "generation must carry no data");
  assert.equal(JSON.stringify(a), "{}");
});

test("the factory takes no arguments and cannot retain anything", () => {
  assert.equal(
    createConnectionGeneration.length,
    0,
    "the factory must not accept the token or room"
  );
  // Even if called with values, nothing is retained.
  const secret = "supabase-access-token-value";
  const generation = (createConnectionGeneration as () => object).call(
    null,
    secret
  );
  assert.deepEqual(Object.keys(generation), []);
  assert.ok(!JSON.stringify(generation).includes(secret));
});

test("same-room token rotation produces a NEW opaque generation", () => {
  const memo = makeConnectionMemo();
  const first = memo("token-one", "inquiry-1");
  const stable = memo("token-one", "inquiry-1");
  assert.equal(stable, first, "an unchanged connection keeps its generation");

  // Same room, rotated token → different connection.
  const rotated = memo("token-two", "inquiry-1");
  assert.notEqual(rotated, first, "token rotation must mint a new generation");
});

test("a room change also produces a new generation", () => {
  const memo = makeConnectionMemo();
  const first = memo("token-one", "inquiry-1");
  const moved = memo("token-one", "inquiry-2");
  assert.notEqual(moved, first);
});

test("no token value appears in the state identity", () => {
  const memo = makeConnectionMemo();
  const secret = "supabase-access-token-value";
  const generation = memo(secret, "inquiry-1");
  const status = { generation, live: true, reason: null };
  // Nothing anywhere in the stored status can reveal the token.
  const serialized = JSON.stringify(status);
  assert.ok(!serialized.includes(secret), "token must not be in status");
  assert.deepEqual(Object.keys(generation), []);
  assert.deepEqual(Object.keys(status).sort(), ["generation", "live", "reason"]);
});

// --- render-time resolution ---

test("a current-generation status is shown as recorded", () => {
  const generation = createConnectionGeneration();
  assert.deepEqual(
    resolveRealtimeStatus({ generation, live: true, reason: null }, generation),
    { live: true, fallbackReason: null }
  );
  assert.deepEqual(
    resolveRealtimeStatus(
      { generation, live: false, reason: "rate_limited" },
      generation
    ),
    { live: false, fallbackReason: "rate_limited" }
  );
});

test("a previous-generation status immediately resolves to connecting", () => {
  const memo = makeConnectionMemo();
  const before = memo("token-one", "inquiry-1");
  // The old connection was live...
  const staleStatus = { generation: before, live: true, reason: null };
  // ...then the token rotated in the same room.
  const after = memo("token-two", "inquiry-1");

  assert.deepEqual(resolveRealtimeStatus(staleStatus, after), {
    live: false,
    fallbackReason: "connecting",
  });
});

test("stale resolution needs no effect, timer, or microtask", () => {
  // Purely synchronous: the value is correct on the very first render.
  const oldGen = createConnectionGeneration();
  const newGen = createConnectionGeneration();
  const resolved = resolveRealtimeStatus(
    { generation: oldGen, live: true, reason: null },
    newGen
  );
  assert.equal(resolved.live, false);
  assert.equal(resolved.fallbackReason, "connecting");
});

// --- source invariants that behaviour alone cannot prove ---

const hookSource = readFileSync(
  new URL("../src/components/messaging/use-messaging-realtime.ts", import.meta.url),
  "utf8"
);

test("the hook never interpolates, hashes, or persists the token", () => {
  assert.ok(
    !hookSource.includes("${accessToken"),
    "token must not be embedded in a template literal"
  );
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "createHash",
    "btoa(",
  ]) {
    assert.ok(!hookSource.includes(forbidden), `hook must not use ${forbidden}`);
  }
});

test("the hook stores the opaque generation and keeps disposed guards", () => {
  assert.match(
    hookSource,
    /useMemo\(\s*\(\)\s*=>\s*createConnectionGeneration\(\)\s*,/,
    "generation must come from the opaque factory"
  );
  assert.match(hookSource, /setStatus\(\{\s*generation/);
  assert.match(hookSource, /let disposed = false;/);
  assert.match(hookSource, /disposed = true;/);
  assert.match(hookSource, /resolveRealtimeStatus\(status, generation\)/);
});
