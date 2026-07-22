// Executable checks for the subject-side healthcare credential workflow:
// lifecycle presentation, eligibility, file validation, bounded processing
// polling, deletion states, the rollout guard, and the private-upload
// boundaries (no Authorization on the signed PUT, no evidence URLs in state).
// Run with:  npm test   (node --test "tests/**/*.test.mts")
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_COUNT,
  canAddEvidence,
  canCreateSubmission,
  canSubmit,
  canWithdraw,
  describeSubmissionStatus,
  hasProcessingEvidence,
  isDeletionStatus,
  isSubmissionEditable,
  isTerminalEvidenceStatus,
  shouldContinueEvidencePolling,
  shouldContinueSubmissionPolling,
  validateAffiliationName,
  validateEvidenceFile,
  affiliationNameLabel,
  affiliationTypeLabel,
  evidenceCategoryLabel,
  healthcareRoleLabel,
  isStaleHealthcareAttempt,
  uploadFailureRecovery,
  healthcareErrorHint,
  resolveAttemptCompletion,
  resolveEvidenceControls,
} from "../src/lib/healthcare/submission.ts";
import { healthcareEvidenceEnabledFrom } from "../src/lib/healthcare/config.ts";

const ALL_STATUSES = [
  "created",
  "uploading",
  "processing",
  "pending_review",
  "approved",
  "rejected",
  "withdrawn",
  "processing_failed",
  "deletion_pending",
  "evidence_deleted",
  "deletion_failed",
];

function submission(overrides = {}) {
  return {
    id: "sub-1",
    version: 1,
    claimedRole: "physician",
    claimedAffiliationName: "Example Hospital",
    claimedAffiliationType: "hospital",
    evidenceCategory: "license",
    status: "created",
    decision: null,
    submittedAt: null,
    decidedAt: null,
    withdrawnAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    evidenceCount: 0,
    evidence: [],
    ...overrides,
  };
}

function evidence(status, id = "e1") {
  return { id, status };
}

// --- lifecycle presentation ---

test("every submission status has a distinct presentation", () => {
  const labels = new Set();
  for (const status of ALL_STATUSES) {
    const presentation = describeSubmissionStatus(status);
    assert.ok(presentation.label.length > 0, `${status} needs a label`);
    assert.ok(presentation.description.length > 0, `${status} needs a description`);
    labels.add(presentation.label);
  }
  assert.equal(labels.size, ALL_STATUSES.length, "labels must not collide");
});

test("decision tones are honest", () => {
  assert.equal(describeSubmissionStatus("approved").tone, "success");
  assert.equal(describeSubmissionStatus("rejected").tone, "danger");
  assert.equal(describeSubmissionStatus("deletion_failed").tone, "warning");
});

// --- deletion state distinctions ---

test("deletion states are distinct from each other", () => {
  for (const status of ["deletion_pending", "evidence_deleted", "deletion_failed"]) {
    assert.equal(isDeletionStatus(status), true, status);
  }
  assert.equal(isDeletionStatus("pending_review"), false);

  const pending = describeSubmissionStatus("deletion_pending");
  const deleted = describeSubmissionStatus("evidence_deleted");
  const failed = describeSubmissionStatus("deletion_failed");
  assert.notEqual(pending.label, deleted.label);
  assert.notEqual(deleted.label, failed.label);
  // Only evidence_deleted may claim deletion is complete.
  assert.match(deleted.description, /deleted/i);
  assert.match(failed.description, /operations/i);
});

// --- create / editable eligibility ---

test("a new submission is blocked while one is active", () => {
  for (const status of ["created", "uploading", "processing", "pending_review"]) {
    assert.equal(
      canCreateSubmission(submission({ status })),
      false,
      status
    );
  }
});

test("a new submission is allowed with no current or a finished one", () => {
  assert.equal(canCreateSubmission(null), true);
  for (const status of ["approved", "rejected", "withdrawn", "deletion_pending", "evidence_deleted", "deletion_failed", "processing_failed"]) {
    assert.equal(canCreateSubmission(submission({ status })), true, status);
  }
});

test("evidence is editable only before review and decisions", () => {
  for (const status of ["created", "uploading", "processing"]) {
    assert.equal(isSubmissionEditable(submission({ status })), true, status);
  }
  for (const status of ["pending_review", "processing_failed", "approved", "rejected", "withdrawn", "deletion_pending", "evidence_deleted", "deletion_failed"]) {
    assert.equal(isSubmissionEditable(submission({ status })), false, status);
  }
});

test("evidence can be added only below the limit of three", () => {
  assert.equal(canAddEvidence(submission({ evidenceCount: 0 })), true);
  assert.equal(canAddEvidence(submission({ evidenceCount: 2 })), true);
  assert.equal(canAddEvidence(submission({ evidenceCount: MAX_EVIDENCE_COUNT })), false);
  // Not editable => cannot add regardless of count.
  assert.equal(
    canAddEvidence(submission({ status: "pending_review", evidenceCount: 0 })),
    false
  );
});

// --- submit requires 1-3 ready evidence ---

test("submit requires at least one evidence record", () => {
  assert.equal(canSubmit(submission({ evidence: [] })), false);
});

test("submit requires every evidence record to be ready", () => {
  assert.equal(
    canSubmit(
      submission({ evidence: [evidence("ready", "a"), evidence("processing", "b")] })
    ),
    false
  );
  assert.equal(
    canSubmit(
      submission({ evidence: [evidence("ready", "a"), evidence("processing_failed", "b")] })
    ),
    false
  );
});

test("submit is allowed for one to three ready records", () => {
  assert.equal(canSubmit(submission({ evidence: [evidence("ready", "a")] })), true);
  assert.equal(
    canSubmit(
      submission({
        evidence: [evidence("ready", "a"), evidence("ready", "b"), evidence("ready", "c")],
      })
    ),
    true
  );
});

test("submit is blocked for more than three records", () => {
  assert.equal(
    canSubmit(
      submission({
        evidence: [
          evidence("ready", "a"),
          evidence("ready", "b"),
          evidence("ready", "c"),
          evidence("ready", "d"),
        ],
      })
    ),
    false
  );
});

test("submit is blocked once the submission is not editable", () => {
  assert.equal(
    canSubmit(submission({ status: "pending_review", evidence: [evidence("ready")] })),
    false
  );
});

// --- withdraw eligibility ---

test("withdraw is allowed before a decision", () => {
  assert.equal(canWithdraw(submission({ status: "pending_review" })), true);
  assert.equal(canWithdraw(submission({ status: "created" })), true);
});

test("withdraw is blocked after a decision or a previous withdrawal", () => {
  assert.equal(
    canWithdraw(submission({ status: "approved", decision: "approved" })),
    false
  );
  assert.equal(
    canWithdraw(submission({ status: "rejected", decision: "rejected" })),
    false
  );
  assert.equal(
    canWithdraw(submission({ status: "withdrawn", withdrawnAt: "2026-07-20T00:00:00.000Z" })),
    false
  );
  assert.equal(canWithdraw(null), false);
});

// --- file validation ---

test("only JPEG, PNG, and WebP are accepted", () => {
  for (const type of ALLOWED_EVIDENCE_TYPES) {
    assert.equal(validateEvidenceFile({ type, size: 1000 }).ok, true, type);
  }
  for (const type of ["application/pdf", "image/gif", "image/heic", "text/plain", ""]) {
    const result = validateEvidenceFile({ type, size: 1000 });
    assert.equal(result.ok, false, type);
    assert.equal(result.code, "unsupported_type");
  }
});

test("images larger than 10 MiB are rejected", () => {
  assert.equal(
    validateEvidenceFile({ type: "image/png", size: MAX_EVIDENCE_BYTES }).ok,
    true
  );
  const tooBig = validateEvidenceFile({
    type: "image/png",
    size: MAX_EVIDENCE_BYTES + 1,
  });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, "too_large");
  assert.equal(MAX_EVIDENCE_BYTES, 10 * 1024 * 1024);
});

test("affiliation name is trimmed and bounded to 1-200 characters", () => {
  assert.deepEqual(validateAffiliationName("  Example Hospital  "), {
    trimmed: "Example Hospital",
    valid: true,
  });
  assert.equal(validateAffiliationName("   ").valid, false);
  assert.equal(validateAffiliationName("a".repeat(200)).valid, true);
  assert.equal(validateAffiliationName("a".repeat(201)).valid, false);
});

// --- processing poll continuation / terminal / timeout ---

test("terminal evidence statuses stop processing", () => {
  for (const status of ["ready", "processing_failed", "deleted"]) {
    assert.equal(isTerminalEvidenceStatus(status), true, status);
  }
  assert.equal(isTerminalEvidenceStatus("processing"), false);
});

test("polling continues while any evidence is still processing", () => {
  const mixed = [evidence("ready", "a"), evidence("processing", "b")];
  assert.equal(hasProcessingEvidence(mixed), true);
  assert.equal(shouldContinueEvidencePolling(mixed, 0, 5), true);
});

test("polling stops when every evidence record is terminal", () => {
  const done = [evidence("ready", "a"), evidence("processing_failed", "b")];
  assert.equal(hasProcessingEvidence(done), false);
  assert.equal(shouldContinueEvidencePolling(done, 0, 5), false);
});

test("polling stops when the attempt budget is exhausted", () => {
  const pending = [evidence("processing", "a")];
  assert.equal(shouldContinueEvidencePolling(pending, 4, 5), true);
  assert.equal(shouldContinueEvidencePolling(pending, 5, 5), false);
});

test("submission polling also continues through deletion_pending only", () => {
  assert.equal(
    shouldContinueSubmissionPolling(submission({ status: "deletion_pending" }), 0, 5),
    true
  );
  assert.equal(
    shouldContinueSubmissionPolling(submission({ status: "evidence_deleted" }), 0, 5),
    false
  );
  assert.equal(
    shouldContinueSubmissionPolling(submission({ status: "deletion_failed" }), 0, 5),
    false
  );
  assert.equal(
    shouldContinueSubmissionPolling(submission({ status: "deletion_pending" }), 5, 5),
    false,
    "budget still bounds deletion polling"
  );
  assert.equal(shouldContinueSubmissionPolling(null, 0, 5), false);
});

test("a replacement cursor restarts the budget independently", () => {
  // The component resets its attempt counter per load cycle; a fresh cycle with
  // the same unfinished state may poll again.
  const pending = submission({ status: "processing", evidence: [evidence("processing")] });
  assert.equal(shouldContinueSubmissionPolling(pending, 5, 5), false);
  assert.equal(shouldContinueSubmissionPolling(pending, 0, 5), true);
});

// --- rollout guard ---

test("only the exact string \"true\" enables the workflow", () => {
  assert.equal(healthcareEvidenceEnabledFrom("true"), true);
  for (const value of ["false", "", "1", "TRUE", "yes", undefined, null]) {
    assert.equal(healthcareEvidenceEnabledFrom(value), false, String(value));
  }
});

test("the panel checks the rollout guard before any healthcare request", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-verification-panel.tsx",
      import.meta.url
    ),
    "utf8"
  );
  // The load effect must bail out before calling the API.
  const effectStart = source.indexOf("useEffect(() => {");
  const guardIndex = source.indexOf("if (!enabled) return;", effectStart);
  const fetchIndex = source.indexOf("getMyHealthcareVerifications(", effectStart);
  assert.ok(guardIndex > -1, "load effect must guard on the rollout flag");
  assert.ok(
    guardIndex < fetchIndex,
    "the rollout guard must precede the API call"
  );
});

// --- signed upload PUT must not carry the bearer token ---

test("the signed storage PUT implementation attaches no Authorization", () => {
  const source = readFileSync(
    new URL("../src/lib/api/uploads.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("export async function uploadFileToSignedUrl");
  assert.ok(start > -1, "uploadFileToSignedUrl must exist");
  const body = source.slice(start);

  assert.match(body, /method:\s*"PUT"/, "the storage transfer must be a PUT");
  assert.ok(
    !/authorization/i.test(body),
    "the signed PUT must never set an Authorization header"
  );
  assert.ok(
    !/bearer/i.test(body) && !/accessToken/.test(body),
    "the signed PUT must never reference the bearer token"
  );
  // It uses the raw global fetch, not the envelope client that attaches auth.
  assert.ok(
    !/apiFetch\(/.test(body),
    "the signed PUT must bypass the authenticated API client"
  );
});

test("healthcare uploads route through the no-auth signed PUT helper", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    source,
    /uploadFileToSignedUrl\(\s*intent\.uploadUrl,\s*file\s*(?:,\s*controller\.signal\s*)?\)/,
    "evidence upload must use the shared no-auth signed PUT helper"
  );
  assert.ok(
    !/fetch\(/.test(source),
    "the component must not issue its own storage fetch"
  );
});

// --- no evidence URL may reach rendered state or persistence ---

test("the evidence manager keeps the signed uploadUrl out of state and storage", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.ok(
    !/useState[^\n]*uploadUrl/i.test(source),
    "uploadUrl must never be held in React state"
  );
  assert.ok(
    !/set[A-Za-z]*\(\s*intent\b/.test(source),
    "the upload intent must not be stored in state"
  );
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "console.log",
  ]) {
    assert.ok(!source.includes(forbidden), `must not use ${forbidden}`);
  }
  // The signed URL is referenced exactly once in CODE: the raw PUT call.
  const code = source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    })
    .join("\n");
  const uses = code.match(/intent\.uploadUrl/g) ?? [];
  assert.equal(uses.length, 1, "uploadUrl must be used only for the PUT");
});

test("no healthcare component renders evidence images or URLs", () => {
  for (const file of [
    "healthcare-evidence-manager.tsx",
    "healthcare-history-list.tsx",
    "healthcare-verification-panel.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../src/components/healthcare/${file}`, import.meta.url),
      "utf8"
    );
    assert.ok(!source.includes("<img"), `${file} must not render images`);
    assert.ok(
      !source.includes("createObjectURL"),
      `${file} must not create local object URLs`
    );
  }
});

// --- F5B correction pass: real backend state machine ---

test("processing_failed is create-eligible but not evidence-editable", () => {
  const failed = submission({ status: "processing_failed" });
  assert.equal(canCreateSubmission(failed), true, "a new version may be started");
  assert.equal(isSubmissionEditable(failed), false, "no more evidence may be added");
  assert.equal(canAddEvidence(failed), false);
  assert.equal(canSubmit(submission({ status: "processing_failed", evidence: [evidence("ready")] })), false);
});

test("processing_failed remains withdrawable so evidence can be deleted", () => {
  assert.equal(canWithdraw(submission({ status: "processing_failed" })), true);
  // ...but not once a decision or withdrawal already exists.
  assert.equal(
    canWithdraw(submission({ status: "processing_failed", decision: "rejected" })),
    false
  );
});

test("processing_failed copy never promises remove or replace", () => {
  const description = describeSubmissionStatus("processing_failed").description;
  assert.ok(!/\bremove\b/i.test(description), description);
  assert.ok(!/\breplace\b/i.test(description), description);
  assert.match(description, /withdraw/i);
});

// --- post-intent failure reconciliation ---

test("a failure before the intent needs no reconciliation", () => {
  const recovery = uploadFailureRecovery(false);
  assert.equal(recovery.reconcile, false);
  assert.equal(recovery.message, null);
});

test("a failure after the intent reconciles and never promises replacement", () => {
  const recovery = uploadFailureRecovery(true);
  assert.equal(recovery.reconcile, true, "GET /me must reconcile the slot count");
  assert.ok(recovery.message);
  assert.ok(!/\breplace\b/i.test(recovery.message));
  assert.ok(!/\bremove\b/i.test(recovery.message));
  assert.match(recovery.message, /withdraw/i);
});

test("the evidence manager reconciles after a post-intent failure", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(source, /intentCreated = true/, "must record intent success");
  assert.match(
    source,
    /uploadFailureRecovery\(intentCreated\)/,
    "the catch path must consult the recovery helper"
  );
  // No invented healthcare evidence deletion, and no generic media endpoints.
  assert.ok(!/deleteUpload|getUploadStatus/.test(source));
  assert.ok(!/evidence\/[^"'`]*delete/i.test(source));
});

// --- stale / aborted attempts ---

test("aborted or superseded attempts are stale", () => {
  assert.equal(isStaleHealthcareAttempt(true, true), true, "aborted");
  assert.equal(isStaleHealthcareAttempt(false, false), true, "superseded");
  assert.equal(isStaleHealthcareAttempt(true, false), true, "both");
  assert.equal(isStaleHealthcareAttempt(false, true), false, "current attempt acts");
});

test("the evidence manager guards every mutation against stale completion", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  // Each async op begins an abortable attempt and checks staleness.
  assert.equal((source.match(/beginAttempt\(\)/g) ?? []).length, 3);
  assert.ok((source.match(/isStale\(controller\)/g) ?? []).length >= 6);
  assert.match(source, /isAbortError\(err\) \|\| isStale\(controller\)/);
  // Unmount / token / submission change cancels in flight work.
  assert.match(source, /abortRef\.current\?\.abort\(\)/);
  assert.match(source, /\[accessToken, submission\.id\]/);
});

test("the signed PUT accepts a cancellation signal and still sends no auth", () => {
  const source = readFileSync(
    new URL("../src/lib/api/uploads.ts", import.meta.url),
    "utf8"
  );
  const body = source.slice(source.indexOf("export async function uploadFileToSignedUrl"));
  assert.match(body, /signal\?: AbortSignal/, "optional signal keeps callers compatible");
  assert.match(body, /method:\s*"PUT"/);
  assert.ok(!/authorization/i.test(body));
  assert.ok(!/bearer/i.test(body) && !/accessToken/.test(body));
  assert.match(body, /AbortError/, "an abort must be rethrown, not masked");
});

// --- nullable legacy metadata ---

test("null legacy claim metadata renders safe fallbacks", () => {
  assert.equal(healthcareRoleLabel(null), "Role not recorded");
  assert.equal(affiliationTypeLabel(null), "Organization type not recorded");
  assert.equal(evidenceCategoryLabel(null), "Evidence type not recorded");
  assert.equal(affiliationNameLabel(null), "Organization not recorded");
  assert.equal(affiliationNameLabel("   "), "Organization not recorded");
});

test("known legacy values still map to human labels", () => {
  assert.equal(healthcareRoleLabel("resident_physician"), "Resident physician");
  assert.equal(affiliationTypeLabel("medical_school"), "Medical school");
  assert.equal(evidenceCategoryLabel("license"), "Professional license");
  assert.equal(affiliationNameLabel("  Example Hospital  "), "Example Hospital");
});

test("labels never emit null, undefined, or an empty string", () => {
  for (const label of [healthcareRoleLabel, affiliationTypeLabel, evidenceCategoryLabel, affiliationNameLabel]) {
    for (const value of [null, undefined, ""]) {
      const result = label(value);
      assert.ok(result.length > 0);
      assert.ok(!/null|undefined/i.test(result), `${result} for ${String(value)}`);
    }
  }
});

// --- F5B micro-correction: attempt ownership and control exclusivity ---

test("an aborted attempt still clears its own busy state", () => {
  // Token/submission change aborts but leaves the slot intact, so the running
  // attempt remains the owner and must clear "Uploading…".
  const attempt = new AbortController();
  const completion = resolveAttemptCompletion(attempt, attempt);
  assert.equal(completion.clearBusyState, true, "must not strand the busy label");
  assert.equal(completion.releaseRef, true);
});

test("a superseded attempt cannot clear a newer attempt's state", () => {
  const older = new AbortController();
  const newer = new AbortController();
  const completion = resolveAttemptCompletion(newer, older);
  assert.equal(completion.clearBusyState, false);
  assert.equal(completion.releaseRef, false);
});

test("aborting on token change cannot leave the operation busy", () => {
  // Simulates the component: begin -> cleanup aborts (ref untouched) -> finally.
  let ref = null;
  let uploading = false;
  const controller = new AbortController();
  ref = controller;
  uploading = true;

  controller.abort(); // cleanup on accessToken / submission.id change
  assert.equal(ref, controller, "cleanup must not invalidate ownership");

  const completion = resolveAttemptCompletion(ref, controller);
  if (completion.releaseRef) ref = null;
  if (completion.clearBusyState) uploading = false;

  assert.equal(uploading, false, "busy state must be cleared after an abort");
  assert.equal(ref, null, "the slot must be released");
});

test("a superseded upload cannot clear the replacement's busy state", () => {
  let ref = null;
  let uploading = false;

  const first = new AbortController();
  ref = first;
  uploading = true;

  // A newer attempt takes the slot.
  const second = new AbortController();
  first.abort();
  ref = second;
  uploading = true;

  // The FIRST attempt now finishes.
  const completion = resolveAttemptCompletion(ref, first);
  if (completion.releaseRef) ref = null;
  if (completion.clearBusyState) uploading = false;

  assert.equal(uploading, true, "the newer attempt stays busy");
  assert.equal(ref, second, "the newer attempt keeps the slot");
});

test("upload, submit, and withdraw controls are mutually exclusive", () => {
  const base = {
    canAdd: true,
    submitReady: true,
    withdrawable: true,
    uploading: false,
    busy: false,
    confirmingWithdraw: false,
  };

  const idle = resolveEvidenceControls(base);
  assert.equal(idle.canUpload, true);
  assert.equal(idle.canSubmit, true);
  assert.equal(idle.canOpenWithdraw, true);

  // Uploading blocks submit and withdraw.
  const uploading = resolveEvidenceControls({ ...base, uploading: true });
  assert.equal(uploading.canSubmit, false);
  assert.equal(uploading.canOpenWithdraw, false);
  assert.equal(uploading.canUpload, false);

  // A running submit/withdraw blocks upload.
  const busy = resolveEvidenceControls({ ...base, busy: true });
  assert.equal(busy.canUpload, false);
  assert.equal(busy.canSubmit, false);
  assert.equal(busy.canConfirmWithdraw, false, "no re-entrant confirmation");

  // An open confirmation blocks upload and submit.
  const confirming = resolveEvidenceControls({
    ...base,
    confirmingWithdraw: true,
  });
  assert.equal(confirming.canUpload, false);
  assert.equal(confirming.canSubmit, false);
  assert.equal(confirming.canConfirmWithdraw, true, "the confirm itself stays usable");
});

test("the manager wires the exclusive control state into every action", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  // Cleanup aborts but must NOT null the ref (that would strand busy state).
  const cleanup = source.slice(
    source.indexOf("useEffect("),
    source.indexOf("const beginAttempt")
  );
  assert.match(cleanup, /abortRef\.current\?\.abort\(\)/);
  assert.ok(
    !/abortRef\.current = null/.test(cleanup),
    "cleanup must not invalidate the running attempt's ownership"
  );
  // Every finally goes through the ownership helper.
  assert.equal((source.match(/finishAttempt\(controller/g) ?? []).length, 3);
  // Controls drive the disabled props; no ad-hoc busy checks remain.
  assert.ok(!/disabled=\{busyAction !== null\}/.test(source));
  assert.match(source, /disabled=\{!controls\.canUpload\}/);
  assert.match(source, /disabled=\{!controls\.canSubmit\}/);
  assert.match(source, /disabled=\{!controls\.canConfirmWithdraw\}/);
  // Handlers guard programmatically too.
  assert.equal((source.match(/controls\.operationInFlight/g) ?? []).length >= 3, true);
});

// --- honest failed-upload guidance ---

test("upload failure hints never say add again, remove, or replace", () => {
  const codes = [
    "MEDIA_UPLOAD_EXPIRED",
    "MEDIA_UPLOAD_OBJECT_MISSING",
    "MEDIA_INPUT_TOO_LARGE",
    "MEDIA_NOT_CONFIGURED",
    "MEDIA_STORAGE_UNAVAILABLE",
    "HEALTHCARE_EVIDENCE_LIMIT_REACHED",
    "HEALTHCARE_EVIDENCE_NOT_READY",
    "HEALTHCARE_SUBMISSION_NOT_EDITABLE",
  ];
  for (const code of codes) {
    const hint = healthcareErrorHint(code);
    assert.ok(hint, `${code} needs guidance`);
    assert.ok(!/add (the image |it )?again/i.test(hint), `${code}: ${hint}`);
    assert.ok(!/\bremove\b/i.test(hint), `${code}: ${hint}`);
    assert.ok(!/\breplace\b/i.test(hint), `${code}: ${hint}`);
  }
  // The two slot-consuming failures point at reconcile + withdraw instead.
  for (const code of ["MEDIA_UPLOAD_EXPIRED", "MEDIA_UPLOAD_OBJECT_MISSING"]) {
    const hint = healthcareErrorHint(code);
    assert.match(hint, /check again/i, code);
    assert.match(hint, /withdraw/i, code);
  }
});

test("processing_failed copy allows a new submission without requiring withdrawal", () => {
  const description = describeSubmissionStatus("processing_failed").description;
  assert.match(description, /new submission/i);
  assert.match(description, /withdraw/i, "deletion remains available");
  assert.ok(!/\bremove\b/i.test(description));
  assert.ok(!/\breplace\b/i.test(description));
  // Withdrawal must not be presented as a prerequisite.
  assert.ok(
    !/withdraw[^.]*\b(then|before|first)\b[^.]*new submission/i.test(description),
    description
  );
  assert.ok(!/must withdraw/i.test(description), description);
});

test("the in-panel processing_failed notice keeps the two options independent", () => {
  const source = readFileSync(
    new URL(
      "../src/components/healthcare/healthcare-evidence-manager.tsx",
      import.meta.url
    ),
    "utf8"
  );
  // Isolate the rendered copy of the duplicate in-panel notice (not the shared
  // describeSubmissionStatus text) so this UI string cannot regress on its own.
  const blockStart = source.indexOf('submission.status === "processing_failed"');
  assert.ok(blockStart > -1, "the processing_failed notice must exist");
  const openTag = source.indexOf("<p className", blockStart);
  const copyStart = source.indexOf(">", openTag) + 1;
  const copyEnd = source.indexOf("</p>", copyStart);
  assert.ok(copyEnd > copyStart, "the notice must render a paragraph");
  const notice = source
    .slice(copyStart, copyEnd)
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  assert.match(notice, /start a new submission/i, notice);
  assert.match(notice, /withdraw/i, notice);
  assert.ok(!/\bremove\b/i.test(notice), notice);
  assert.ok(!/\breplace\b/i.test(notice), notice);
  // Withdrawal must never be sequenced before starting a new submission.
  for (const word of ["then", "before", "first"]) {
    assert.ok(
      !new RegExp(`\b${word}\b`, "i").test(notice),
      `notice must not sequence the options with "${word}": ${notice}`
    );
  }
});
