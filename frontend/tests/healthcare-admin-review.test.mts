// Executable checks for the Admin healthcare review surface: queue query
// construction, decision eligibility, transient evidence-URL validation, the
// rollout guard, and the privacy invariants (no preloading, no URL persistence).
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ANY_FILTER,
  APPROVAL_REASON_CODE,
  MAX_DECISION_NOTE_LENGTH,
  REJECTION_REASON_CODES,
  buildAdminQueueQuery,
  canSubmitDecision,
  decisionNoteState,
  defaultReasonCodeFor,
  createEvidenceViewGeneration,
  evidenceViewRemainingMs,
  isEvidenceViewStale,
  isLoopbackHost,
  isRejectionReasonCode,
  isSafeEvidenceViewUrl,
  MAX_EVIDENCE_VIEW_MS,
  normalizeEvidenceViewUrl,
  resolveEffectiveExpiryMs,
  resolveEvidenceViewState,
  shouldClearDecisionRecorded,
} from "../src/lib/healthcare/admin-review.ts";
import { resolveAttemptCompletion } from "../src/lib/healthcare/submission.ts";
import {
  affiliationNameLabel,
  affiliationTypeLabel,
  evidenceCategoryLabel,
  healthcareRoleLabel,
} from "../src/lib/healthcare/submission.ts";
import { healthcareEvidenceEnabledFrom } from "../src/lib/healthcare/config.ts";

const baseFilters = {
  status: "pending_review",
  role: ANY_FILTER,
  evidenceCategory: ANY_FILTER,
  page: 1,
  limit: 20,
};

// --- queue query construction ---

test("status is always sent explicitly", () => {
  // The backend applies `status ?? pending_review`, so an omitted status would
  // silently mean pending_review — there is no honest "all statuses" query.
  const query = buildAdminQueueQuery(baseFilters);
  assert.equal(query.status, "pending_review");
  const approved = buildAdminQueueQuery({ ...baseFilters, status: "approved" });
  assert.equal(approved.status, "approved");
});

test("optional filters are omitted when set to any", () => {
  const query = buildAdminQueueQuery(baseFilters);
  assert.ok(!("role" in query), "role must be omitted");
  assert.ok(!("evidenceCategory" in query), "evidenceCategory must be omitted");
});

test("selected optional filters are included", () => {
  const query = buildAdminQueueQuery({
    ...baseFilters,
    role: "physician",
    evidenceCategory: "license",
  });
  assert.equal(query.role, "physician");
  assert.equal(query.evidenceCategory, "license");
});

test("pagination is passed through", () => {
  const query = buildAdminQueueQuery({ ...baseFilters, page: 3, limit: 50 });
  assert.equal(query.page, 3);
  assert.equal(query.limit, 50);
});

// --- nullable legacy metadata reuses the safe fallbacks ---

test("admin views reuse the shared null-safe claim labels", () => {
  assert.equal(healthcareRoleLabel(null), "Role not recorded");
  assert.equal(affiliationTypeLabel(null), "Organization type not recorded");
  assert.equal(evidenceCategoryLabel(null), "Evidence type not recorded");
  assert.equal(affiliationNameLabel(null), "Organization not recorded");
  for (const label of [
    healthcareRoleLabel,
    affiliationTypeLabel,
    evidenceCategoryLabel,
    affiliationNameLabel,
  ]) {
    assert.ok(!/null|undefined/i.test(label(undefined)));
  }
});

// --- decision / reason eligibility ---

test("approve requires the confirmed-information reason", () => {
  assert.equal(
    canSubmitDecision({
      decision: "approved",
      reasonCode: APPROVAL_REASON_CODE,
      note: "",
    }),
    true
  );
  for (const code of REJECTION_REASON_CODES) {
    assert.equal(
      canSubmitDecision({ decision: "approved", reasonCode: code, note: "" }),
      false,
      code
    );
  }
});

test("reject requires one of the four rejection reasons", () => {
  for (const code of REJECTION_REASON_CODES) {
    assert.equal(
      canSubmitDecision({ decision: "rejected", reasonCode: code, note: "" }),
      true,
      code
    );
  }
  assert.equal(
    canSubmitDecision({
      decision: "rejected",
      reasonCode: APPROVAL_REASON_CODE,
      note: "",
    }),
    false,
    "approval reason cannot reject"
  );
  assert.equal(
    canSubmitDecision({ decision: "rejected", reasonCode: null, note: "" }),
    false
  );
});

test("no decision means nothing can be submitted", () => {
  assert.equal(
    canSubmitDecision({ decision: null, reasonCode: APPROVAL_REASON_CODE, note: "" }),
    false
  );
});

test("default reason code follows the chosen decision", () => {
  assert.equal(defaultReasonCodeFor("approved"), APPROVAL_REASON_CODE);
  assert.equal(defaultReasonCodeFor("rejected"), null, "reject must be chosen");
});

test("isRejectionReasonCode rejects unknown and approval codes", () => {
  assert.equal(isRejectionReasonCode("other"), true);
  assert.equal(isRejectionReasonCode(APPROVAL_REASON_CODE), false);
  assert.equal(isRejectionReasonCode("made_up"), false);
  assert.equal(isRejectionReasonCode(null), false);
});

test("the note is optional and bounded at 1000 characters", () => {
  assert.equal(decisionNoteState("").valid, true);
  assert.equal(decisionNoteState("  hello  ").trimmed, "hello");
  assert.equal(decisionNoteState("a".repeat(MAX_DECISION_NOTE_LENGTH)).valid, true);
  const tooLong = decisionNoteState("a".repeat(MAX_DECISION_NOTE_LENGTH + 1));
  assert.equal(tooLong.valid, false);
  assert.equal(
    canSubmitDecision({
      decision: "approved",
      reasonCode: APPROVAL_REASON_CODE,
      note: "a".repeat(MAX_DECISION_NOTE_LENGTH + 1),
    }),
    false,
    "an over-length note blocks submission"
  );
});

// --- evidence view URL scheme and expiry ---

test("production accepts HTTPS and rejects arbitrary HTTP", () => {
  const PROD = false; // allowLoopbackHttp === false
  assert.equal(isSafeEvidenceViewUrl("https://storage.example/x?token=a", PROD), true);
  assert.equal(
    isSafeEvidenceViewUrl("http://storage.example/x", PROD),
    false,
    "arbitrary production HTTP must never render"
  );
  // Not even loopback HTTP is allowed in production.
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(isSafeEvidenceViewUrl(`http://${host}/object/x`, PROD), false, host);
  }
});

test("development permits loopback HTTP only", () => {
  const DEV = true;
  for (const host of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
    assert.equal(isSafeEvidenceViewUrl(`http://${host}:54321/x`, DEV), true, host);
  }
  for (const host of ["storage.example", "10.0.0.5", "evil.localhost.example"]) {
    assert.equal(
      isSafeEvidenceViewUrl(`http://${host}/x`, DEV),
      false,
      `non-loopback ${host} must be rejected`
    );
  }
  assert.equal(isSafeEvidenceViewUrl("https://storage.example/x", DEV), true);
});

test("isLoopbackHost recognises only real loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["localhost.evil.com", "127.0.0.2", "example.com", ""]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test("dangerous and malformed URLs are always rejected", () => {
  for (const allow of [true, false]) {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "blob:https://example.com/abc",
      "file:///etc/passwd",
      "//evil.example/x",
      "/relative/path",
      "not a url",
      "",
      "   ",
      null,
      undefined,
      42,
    ]) {
      assert.equal(isSafeEvidenceViewUrl(bad, allow), false, String(bad));
      assert.equal(normalizeEvidenceViewUrl(bad, allow), null, String(bad));
    }
  }
});

test("normalize returns a canonical href for accepted URLs", () => {
  assert.equal(
    normalizeEvidenceViewUrl("  https://storage.example/x?a=1  ", false),
    "https://storage.example/x?a=1"
  );
});

// --- visible lifetime cap ---

test("visible lifetime is capped at 60 seconds from receipt", () => {
  const received = Date.UTC(2026, 6, 22, 12, 0, 0);
  // Backend claims 10 minutes; the client caps it at 60s.
  const generous = resolveEffectiveExpiryMs(
    new Date(received + 600_000).toISOString(),
    received
  );
  assert.equal(generous, received + MAX_EVIDENCE_VIEW_MS);
  assert.equal(MAX_EVIDENCE_VIEW_MS, 60_000);

  // A shorter backend expiry wins.
  const short = resolveEffectiveExpiryMs(
    new Date(received + 15_000).toISOString(),
    received
  );
  assert.equal(short, received + 15_000);

  // Malformed expiry is unusable.
  assert.equal(resolveEffectiveExpiryMs("not-a-date", received), null);
});

test("a URL beyond the cap stops rendering at 60 seconds", () => {
  const received = Date.UTC(2026, 6, 22, 12, 0, 0);
  const view = {
    viewUrl: "https://storage.example/x",
    expiresAt: new Date(received + 600_000).toISOString(),
    receivedAtMs: received,
  };
  assert.equal(resolveEvidenceViewState(view, received + 59_000, false).renderable, true);
  assert.equal(
    resolveEvidenceViewState(view, received + 60_001, false).reason,
    "expired",
    "the client cap must expire it regardless of the backend value"
  );
  assert.equal(
    evidenceViewRemainingMs(view.expiresAt, received, received + 30_000),
    30_000
  );
});

test("missing, unsafe, invalid-expiry, and expired URLs are not renderable", () => {
  const received = Date.UTC(2026, 6, 22, 12, 0, 0);
  assert.deepEqual(resolveEvidenceViewState(null, received, false), {
    renderable: false,
    reason: "missing",
  });
  assert.equal(
    resolveEvidenceViewState(
      {
        viewUrl: "http://storage.example/x",
        expiresAt: new Date(received + 30_000).toISOString(),
        receivedAtMs: received,
      },
      received,
      false
    ).reason,
    "unsafe_url"
  );
  assert.equal(
    resolveEvidenceViewState(
      { viewUrl: "https://storage.example/x", expiresAt: "nope", receivedAtMs: received },
      received,
      false
    ).reason,
    "invalid_expiry"
  );
  assert.equal(
    resolveEvidenceViewState(
      {
        viewUrl: "https://storage.example/x",
        expiresAt: new Date(received - 1).toISOString(),
        receivedAtMs: received,
      },
      received,
      false
    ).reason,
    "expired"
  );
});

test("remaining time is clamped and never negative", () => {
  const received = Date.UTC(2026, 6, 22, 12, 0, 0);
  assert.equal(
    evidenceViewRemainingMs(new Date(received + 45_000).toISOString(), received, received),
    45_000
  );
  assert.equal(
    evidenceViewRemainingMs(new Date(received - 5_000).toISOString(), received, received),
    0
  );
  assert.equal(evidenceViewRemainingMs("nonsense", received, received), 0);
});

// --- opaque generation invalidation ---

test("each minted generation is a distinct opaque object", () => {
  const a = createEvidenceViewGeneration();
  const b = createEvidenceViewGeneration();
  assert.notEqual(a, b, "a new context must mint a new identity");
  assert.deepEqual(Object.keys(a), [], "the generation must carry no data");
  assert.equal(JSON.stringify(a), "{}");
});

test("a held URL from an older generation is synchronously stale", () => {
  const older = createEvidenceViewGeneration();
  const current = createEvidenceViewGeneration();
  assert.equal(isEvidenceViewStale(current, older), true);
  assert.equal(isEvidenceViewStale(current, current), false);
  assert.equal(isEvidenceViewStale(current, null), false, "nothing held is not stale");
});

test("a stale generation makes the held view non-renderable during render", () => {
  const received = Date.UTC(2026, 6, 22, 12, 0, 0);
  const older = createEvidenceViewGeneration();
  const current = createEvidenceViewGeneration();
  const held = {
    generation: older,
    viewUrl: "https://storage.example/x",
    expiresAt: new Date(received + 30_000).toISOString(),
    receivedAtMs: received,
  };
  // This mirrors the component: stale generations resolve to null BEFORE the
  // view state is computed, so no effect cleanup is required.
  const effective = isEvidenceViewStale(current, held.generation) ? null : held;
  assert.equal(effective, null);
  assert.equal(resolveEvidenceViewState(effective, received, false).renderable, false);
});

// --- rollout guard ---

test("the rollout guard only enables on the exact string true", () => {
  assert.equal(healthcareEvidenceEnabledFrom("true"), true);
  for (const value of ["false", "", "1", "TRUE", undefined, null]) {
    assert.equal(healthcareEvidenceEnabledFrom(value), false, String(value));
  }
});

function adminSource(file) {
  return readFileSync(
    new URL(`../src/components/admin/${file}`, import.meta.url),
    "utf8"
  );
}

test("the queue never mounts its requesting component while disabled", () => {
  const source = adminSource("admin-healthcare-queue.tsx");
  const guard = source.indexOf("if (!enabled) {");
  const mount = source.indexOf("<QueueContent");
  const request = source.indexOf("listAdminHealthcareVerifications(");
  assert.ok(guard > -1, "the queue must guard on the rollout flag");
  assert.ok(guard < mount, "the guard must precede mounting the requester");
  assert.ok(mount < request, "the request lives inside the guarded component");
});

test("the detail never mounts its requesting component while disabled", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  // The guard short-circuits in the OUTER component, so the component that
  // issues the request is never rendered at all while the rollout is off.
  const guard = source.indexOf("if (!enabled) {");
  const mount = source.indexOf("<DetailContent");
  const request = source.indexOf("getAdminHealthcareVerification(");
  assert.ok(guard > -1, "the detail must guard on the rollout flag");
  assert.ok(guard < mount, "the guard must precede mounting the requester");
  assert.ok(mount < request, "the request lives inside the guarded component");
});

// --- privacy invariants ---

test("the queue never preloads or renders evidence", () => {
  const source = adminSource("admin-healthcare-queue.tsx");
  assert.ok(!source.includes("<img"), "the queue must not render images");
  assert.ok(
    !/createAdminEvidenceViewUrl/.test(source),
    "the queue must never mint evidence view URLs"
  );
});

test("the evidence viewer keeps the signed URL out of routes, storage, and logs", () => {
  const source = adminSource("admin-healthcare-evidence-viewer.tsx");
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "console.log",
    "console.error",
    "router.push",
    "searchParams",
    "window.location",
  ]) {
    assert.ok(!source.includes(forbidden), `must not use ${forbidden}`);
  }
  // The URL is only ever read from the validated, in-memory held view.
  assert.match(source, /src=\{held\.viewUrl\}/);
  assert.match(source, /referrerPolicy="no-referrer"/);
  // It is rendered only once the pure validator says so.
  assert.match(source, /viewState\.renderable && held/);
  // Errors never echo the URL.
  assert.ok(!/message:\s*[^\n]*viewUrl/.test(source));
});

test("the viewer requests a URL only from an explicit action and clears it", () => {
  const source = adminSource("admin-healthcare-evidence-viewer.tsx");
  // Minting happens in the click handler, not on mount.
  assert.match(source, /onClick=\{requestView\}/);
  const effects = source.match(/useEffect\(/g) ?? [];
  assert.ok(effects.length >= 2, "cleanup and expiry effects must exist");
  assert.match(source, /\[accessToken, verificationId, evidence\.id, clearToken\]/);
  assert.match(source, /setTimeout\(\(\) => setView\(null\), Math\.max\(0, remaining\)\)/);
});

test("a successful decision clears every held evidence URL", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  const decided = source.slice(source.indexOf("onDecided={"));
  assert.match(
    decided,
    /setClearToken\(\(token\) => token \+ 1\)/,
    "decision success must bump the clear token"
  );
  // Refresh and token rotation clear too.
  assert.ok((source.match(/setClearToken/g) ?? []).length >= 3);
});

test("decision state changes only after the backend succeeds", () => {
  const source = adminSource("admin-healthcare-decision-form.tsx");
  const submitBody = source.slice(
    source.indexOf("const submit = async"),
    source.indexOf("const isRateLimited")
  );
  const awaitIndex = submitBody.indexOf("await decideAdminHealthcareVerification");
  const onDecidedIndex = submitBody.indexOf("onDecided(result)");
  assert.ok(awaitIndex > -1 && onDecidedIndex > awaitIndex, "must await the PATCH first");
  // No optimistic local decision state is applied before the request.
  assert.ok(
    submitBody.indexOf("setConfirming(false)") > awaitIndex,
    "UI must not settle before the backend confirms"
  );
});

test("admin review never calls generic media endpoints", () => {
  for (const file of [
    "admin-healthcare-queue.tsx",
    "admin-healthcare-detail.tsx",
    "admin-healthcare-evidence-viewer.tsx",
    "admin-healthcare-decision-form.tsx",
  ]) {
    const source = adminSource(file);
    assert.ok(!/getUploadStatus|deleteUpload|uploads\//.test(source), file);
  }
});

// --- stale response / concurrency invariants ---

test("a stale view response cannot install a URL", () => {
  const source = adminSource("admin-healthcare-evidence-viewer.tsx");
  const requestBody = source.slice(source.indexOf("const requestView = async"));
  // The attempt captures its generation and re-checks abort + ownership +
  // generation before any setState.
  assert.match(requestBody, /const attemptGeneration = generation;/);
  const guard =
    /controller\.signal\.aborted \|\|\s*requestRef\.current !== controller \|\|\s*attemptGeneration !== generation/;
  assert.ok(
    (requestBody.match(new RegExp(guard, "g")) ?? []).length >= 2,
    "both the success and failure paths must reject stale attempts"
  );
  // The guard runs before the URL is held.
  assert.ok(
    requestBody.search(guard) < requestBody.indexOf("setView({"),
    "staleness must be checked before installing the URL"
  );
});

test("the viewer normalizes before holding and never renders a raw response", () => {
  const source = adminSource("admin-healthcare-evidence-viewer.tsx");
  assert.match(source, /normalizeEvidenceViewUrl\(\s*result\.viewUrl/);
  assert.match(source, /viewUrl: normalized/, "only the normalized href is held");
  assert.ok(
    !/viewUrl: result\.viewUrl/.test(source),
    "the raw backend URL must never be held directly"
  );
  assert.match(source, /referrerPolicy="no-referrer"/);
});

test("a stale decision response cannot call onDecided", () => {
  const source = adminSource("admin-healthcare-decision-form.tsx");
  const submitBody = source.slice(
    source.indexOf("const submit = async"),
    source.indexOf("const isRateLimited")
  );
  assert.match(submitBody, /const isStale = \(\) =>/);
  assert.match(
    submitBody,
    /controller\.signal\.aborted \|\| attemptRef\.current !== controller/
  );
  const staleGuard = submitBody.indexOf("if (isStale()) return;");
  const onDecided = submitBody.indexOf("onDecided(result)");
  assert.ok(staleGuard > -1 && staleGuard < onDecided, "stale must return before onDecided");
  // AbortError is swallowed, not surfaced as a failure.
  assert.match(submitBody, /err\.name === "AbortError"\) return;/);
  // Abort on unmount / token change / submission change.
  assert.match(source, /\[accessToken, verificationId\]/);
});

test("duplicate decision submissions are blocked", () => {
  const source = adminSource("admin-healthcare-decision-form.tsx");
  assert.match(
    source,
    /if \(!ready \|\| submitting \|\| !decision \|\| !reasonCode\) return;/,
    "re-entrant submits must be refused"
  );
});

test("a successful PATCH disables further decisions before GET completes", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  const handler = source.slice(
    source.indexOf("onDecided={"),
    source.indexOf("onRefresh={refresh}")
  );
  // Clearing URLs and blocking further decisions happen synchronously, BEFORE
  // the authoritative reload is even started.
  const clearIdx = handler.indexOf("setClearToken");
  const recordedIdx = handler.indexOf("setDecisionRecorded(true)");
  const loadIdx = handler.indexOf("load()");
  assert.ok(clearIdx > -1 && recordedIdx > -1 && loadIdx > -1);
  assert.ok(clearIdx < loadIdx, "evidence URLs clear before the reload");
  assert.ok(recordedIdx < loadIdx, "further decisions are blocked before the reload");
  // The form is gated on the recorded flag, not only on reloaded detail.
  assert.match(source, /isPending && !decided && !decisionRecorded &&/);
});

test("a failed authoritative reload keeps an honest recorded state, not a form", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  const recorded = source.slice(source.indexOf("{decisionRecorded && ("));
  assert.match(recorded, /Decision recorded/);
  assert.match(recorded, /couldn&apos;t reload the\s*\n?\s*authoritative state/);
  assert.match(recorded, /Refresh/);
  // Nothing is fabricated from the PATCH response.
  assert.ok(!/reviewerId:/.test(recorded));
});

test("stale queue and detail responses cannot overwrite the current context", () => {
  for (const file of ["admin-healthcare-queue.tsx", "admin-healthcare-detail.tsx"]) {
    const source = adminSource(file);
    assert.match(
      source,
      /const isStale = \(\) =>\s*\n?\s*controller\.signal\.aborted \|\| requestRef\.current !== controller;/,
      `${file} must check abort AND ownership`
    );
    // Applied on both success and failure paths.
    assert.ok(
      (source.match(/if \(isStale\(\)\) return;/g) ?? []).length >= 2,
      `${file} must guard both then and catch`
    );
  }
});

test("route id or account change resets all submission-specific state", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  // Remounting by (submission, account) is what guarantees the reset.
  assert.match(source, /key=\{`\$\{validId\}:\$\{user\?\.id \?\? "anonymous"\}`\}/);
  // All submission-specific state lives inside the remounted component, so the
  // remount is what clears it.
  const inner = source.slice(source.indexOf("function DetailContent"));
  for (const declaration of [
    "[detail, setDetail]",
    "[clearToken, setClearToken]",
    "[decisionRecorded, setDecisionRecorded]",
    "[loadError, setLoadError]",
    "[phase, setPhase]",
  ]) {
    assert.ok(
      inner.includes(declaration),
      `${declaration} must live inside the remounted component`
    );
  }
  // The outer guard component holds no submission state of its own.
  const outer = source.slice(
    source.indexOf("export default function AdminHealthcareDetail"),
    source.indexOf("function DetailContent")
  );
  assert.ok(!outer.includes("useState"), "the outer guard must be stateless");
});

// --- decision-form attempt ownership (same rules as the accepted F5B pattern) ---

test("an aborted decision attempt still clears its own busy state", () => {
  // Cleanup aborts but leaves the ref intact, so the attempt still owns it.
  const attempt = {};
  const completion = resolveAttemptCompletion(attempt, attempt);
  assert.equal(completion.clearBusyState, true, '"Recording…" must not stick');
  assert.equal(completion.releaseRef, true);
});

test("a superseded decision attempt cannot clear a newer attempt's state", () => {
  const older = {};
  const newer = {};
  const completion = resolveAttemptCompletion(newer, older);
  assert.equal(completion.clearBusyState, false);
  assert.equal(completion.releaseRef, false);
});

test("the decision form uses ownership cleanup, not a nulled ref", () => {
  const source = adminSource("admin-healthcare-decision-form.tsx");
  const cleanup = source.slice(
    source.indexOf("const attemptRef"),
    source.indexOf("const noteState")
  );
  assert.match(cleanup, /attemptRef\.current\?\.abort\(\);/);
  assert.ok(
    !/attemptRef\.current = null;/.test(cleanup),
    "cleanup must not destroy ownership before finally runs"
  );
  assert.match(source, /\[accessToken, verificationId\]/);
  // finally delegates to the shared ownership helper.
  assert.match(source, /resolveAttemptCompletion\(attemptRef\.current, controller\)/);
  assert.match(source, /if \(completion\.releaseRef\) attemptRef\.current = null;/);
  assert.match(source, /if \(completion\.clearBusyState\) setSubmitting\(false\);/);
});

// --- decisionRecorded convergence ---

test("convergence clears the interim panel once the decision is authoritative", () => {
  assert.equal(
    shouldClearDecisionRecorded({ status: "deletion_pending", decision: "approved" }),
    true
  );
  // Status left pending_review even before decision metadata is populated.
  assert.equal(
    shouldClearDecisionRecorded({ status: "deletion_pending", decision: null }),
    true
  );
  assert.equal(
    shouldClearDecisionRecorded({ status: "approved", decision: "approved" }),
    true
  );
});

test("an unexpectedly stale pending_review reload keeps the recorded state", () => {
  assert.equal(
    shouldClearDecisionRecorded({ status: "pending_review", decision: null }),
    false,
    "a stale replica must not un-record the decision"
  );
});

test("a failed reload keeps the recorded state", () => {
  // No detail at all (load threw) => nothing to converge on.
  assert.equal(shouldClearDecisionRecorded(null), false);
});

test("the detail converges only inside the successful load path", () => {
  const source = adminSource("admin-healthcare-detail.tsx");
  const thenBlock = source.slice(
    source.indexOf(".then((data) => {"),
    source.indexOf(".catch((error)")
  );
  assert.match(thenBlock, /shouldClearDecisionRecorded\(data\)/);
  assert.match(thenBlock, /setDecisionRecorded\(false\)/);
  // The catch path must never clear it.
  const catchBlock = source.slice(source.indexOf(".catch((error)"));
  assert.ok(
    !/setDecisionRecorded\(false\)/.test(
      catchBlock.slice(0, catchBlock.indexOf("}, [id, accessToken]"))
    ),
    "a failed reload must retain the recorded state"
  );
});

// --- queue account isolation ---

test("the queue is remounted per account id, never per token", () => {
  const source = adminSource("admin-healthcare-queue.tsx");
  assert.match(source, /<QueueContent key=\{user\?\.id \?\? "anonymous"\} \/>/);
  const outer = source.slice(
    source.indexOf("export default function AdminHealthcareQueue"),
    source.indexOf("function QueueContent")
  );
  // The outer guard must not key on, or hold, the access token.
  assert.ok(!outer.includes("accessToken"), "the key must not use the token");
  assert.ok(!outer.includes("useState"), "the outer guard must be stateless");
});

test("all queue state lives inside the account-keyed component", () => {
  const source = adminSource("admin-healthcare-queue.tsx");
  const inner = source.slice(source.indexOf("function QueueContent"));
  for (const declaration of [
    "[status, setStatus]",
    "[role, setRole]",
    "[category, setCategory]",
    "[page, setPage]",
    "[state, setState]",
  ]) {
    assert.ok(inner.includes(declaration), `${declaration} must be account-scoped`);
  }
  assert.match(inner, /const requestRef = useRef<AbortController \| null>\(null\);/);
});

// --- evidence viewer async generation ownership ---

test("the viewer compares against the LATEST generation, not its own render", () => {
  const source = adminSource("admin-healthcare-evidence-viewer.tsx");
  // A ref tracks the current generation; comparing two values from the same
  // render closure could never detect a change.
  assert.match(source, /const generationRef = useRef<EvidenceViewGeneration>\(generation\);/);
  assert.match(source, /generationRef\.current = generation;/);

  // The ref MUST be updated at layout-effect timing. With a passive effect there
  // is a window after the context-changing render commits but before the effect
  // runs, during which a stale async response would still see the old
  // generation and could touch view/error/loading state.
  assert.match(source, /import \{[^}]*useLayoutEffect[^}]*\} from "react";/);
  const assignmentIndex = source.indexOf("generationRef.current = generation;");
  assert.ok(assignmentIndex > -1, "the ref assignment must exist");
  const enclosingHook = source.lastIndexOf("useLayoutEffect(", assignmentIndex);
  const passiveHook = source.lastIndexOf("useEffect(", assignmentIndex);
  assert.ok(
    enclosingHook > -1 && enclosingHook > passiveHook,
    "generationRef must be updated inside useLayoutEffect, not a passive useEffect"
  );
  assert.match(
    source.slice(enclosingHook, assignmentIndex + 120),
    /useLayoutEffect\(\(\) => \{\s*generationRef\.current = generation;\s*\}, \[generation\]\);/,
    "the layout effect must track the generation dependency"
  );
  const requestBody = source.slice(source.indexOf("const requestView = async"));
  assert.ok(
    !/attemptGeneration !== generation\b(?!Ref)/.test(requestBody),
    "must not compare against the stale render-scoped generation"
  );
  // Success, failure, and finally all compare against the ref.
  assert.equal(
    (requestBody.match(/attemptGeneration !== generationRef\.current/g) ?? []).length,
    2,
    "success and failure paths must check the latest generation"
  );
  assert.match(
    requestBody,
    /attemptGeneration === generationRef\.current/,
    "finally must check the latest generation too"
  );
});
