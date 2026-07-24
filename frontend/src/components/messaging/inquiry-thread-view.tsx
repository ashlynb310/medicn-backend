"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Lock,
  RefreshCw,
  SearchX,
  Send,
  WifiOff,
} from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { useAuth } from "@/components/auth/auth-provider";
import { useMessagingRealtime } from "@/components/messaging/use-messaging-realtime";
import {
  closeInquiry as closeInquiryRequest,
  getInquiryThread,
  markInquiryRead,
  sendInquiryMessage,
  setInquiryArchived,
} from "@/lib/api/messaging";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  applyThreadPage,
  createEventIdCache,
  isCatchUpStalled,
  latestSequence,
  type ThreadState,
} from "@/lib/messaging/thread-state";
import { createSerialRunner } from "@/lib/messaging/serial-runner";
import { evaluateMessage } from "@/lib/messaging/message-content";
import { resolveReadAck } from "@/lib/messaging/read-cursor";
import type { InquiryMessage, InquirySummary } from "@/lib/api/types";

const PAGE_LIMIT = 100;
const PAGES_PER_BATCH = 20;
const MAX_BATCHES = 10;

function messageErrorHint(code: string): string | null {
  switch (code) {
    case "INQUIRY_CLOSED":
      return "This conversation is closed, so new messages can't be sent.";
    case "CONTACT_INFORMATION_NOT_ALLOWED":
      return "For everyone's safety, phone numbers and email addresses can't be sent through MediCN messages.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email address before sending messages.";
    case "ACCOUNT_DISABLED":
      return "This account can't send messages.";
    default:
      return null;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Keys the thread content by inquiry + user so switching conversations (or
 * accounts) remounts with completely fresh state — messages, cursor, event
 * cache, read cursor, and errors can never leak between conversations.
 */
export default function InquiryThreadView({ inquiryId }: { inquiryId: string }) {
  const { user } = useAuth();
  return (
    <ThreadContent
      key={`${inquiryId}:${user?.id ?? "anonymous"}`}
      inquiryId={inquiryId}
    />
  );
}

function ThreadContent({ inquiryId }: { inquiryId: string }) {
  const { accessToken, user } = useAuth();

  const [phase, setPhase] = useState<"loading" | "ready" | "not_found" | "error">(
    "loading"
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inquiry, setInquiry] = useState<InquirySummary | null>(null);
  const [messages, setMessages] = useState<InquiryMessage[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);
  // Close/archive failures are kept separate so they stay visible even when the
  // composer is hidden on a closed thread.
  const [actionError, setActionError] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [busyAction, setBusyAction] = useState<null | "close" | "archive">(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const threadRef = useRef<ThreadState>({ messages: [], cursor: 0, hasMore: false });
  const eventCacheRef = useRef(createEventIdCache(200));
  const abortRef = useRef<AbortController | null>(null);
  // Highest sequence the BACKEND acknowledged, vs. the highest we want to send.
  const ackedReadRef = useRef(0);
  const targetReadRef = useRef(0);
  const readInFlightRef = useRef(false);

  /**
   * Sequence-based REST catch-up. Pages while `hasMore`, yielding between
   * batches instead of truncating, and stops with an honest error if the cursor
   * fails to advance. This is the ONLY way messages enter the thread.
   */
  const runCatchUp = useCallback(async () => {
    const signal = abortRef.current?.signal;
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        for (let page = 0; page < PAGES_PER_BATCH; page += 1) {
          const before = threadRef.current;
          const result = await getInquiryThread(
            inquiryId,
            { afterSequence: before.cursor, limit: PAGE_LIMIT },
            accessToken ?? undefined,
            signal
          );
          if (signal?.aborted) return;
          const after = applyThreadPage(before, result);
          threadRef.current = after;
          setInquiry(result.inquiry);
          setMessages(after.messages);
          setPhase("ready");
          setLoadError(null);

          if (isCatchUpStalled(before, after)) {
            setLoadError(
              "We couldn't load the rest of this conversation. Try refreshing."
            );
            return;
          }
          if (!after.hasMore) return;
        }
        // Batch budget spent with more to read: yield, then continue.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) return;
      }
      setLoadError(
        "This conversation is very long and is still loading. Refresh to continue."
      );
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof ApiError && error.code === "NOT_FOUND") {
        setPhase("not_found");
        return;
      }
      setLoadError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
      setPhase((current) => (current === "loading" ? "error" : current));
    }
  }, [inquiryId, accessToken]);

  // Serialized so a notification arriving mid-run schedules exactly one rerun
  // instead of being dropped or overlapping.
  const runnerRef = useRef<ReturnType<typeof createSerialRunner> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    const runner = createSerialRunner(runCatchUp);
    runnerRef.current = runner;
    void runner.schedule();
    return () => {
      controller.abort();
      if (runnerRef.current === runner) runnerRef.current = null;
    };
  }, [runCatchUp]);

  const scheduleCatchUp = useCallback(() => {
    void runnerRef.current?.schedule();
  }, []);

  /**
   * Sends the read cursor, coalescing newer targets while a request is running.
   * `ackedReadRef` advances ONLY from the backend-confirmed lastReadSequence
   * (never from the requested target). A failure — or a success that fails to
   * advance the cursor toward the target — breaks the loop, so there is no
   * request storm, while leaving the target retryable.
   */
  const flushRead = useCallback(async () => {
    if (readInFlightRef.current) return;
    readInFlightRef.current = true;
    try {
      while (targetReadRef.current > ackedReadRef.current) {
        const target = targetReadRef.current;
        try {
          const result = await markInquiryRead(
            inquiryId,
            target,
            accessToken ?? undefined
          );
          const outcome = resolveReadAck(
            ackedReadRef.current,
            target,
            result.lastReadSequence
          );
          ackedReadRef.current = outcome.acked;
          setInquiry((current) =>
            current
              ? {
                  ...current,
                  unreadCount: result.unreadCount,
                  lastReadSequence: result.lastReadSequence,
                }
              : current
          );
          if (outcome.stalled) {
            setReadError(true);
            break;
          }
          setReadError(false);
        } catch {
          // Non-blocking: retried when new messages arrive, on reconnect, or
          // via manual refresh.
          setReadError(true);
          break;
        }
      }
    } finally {
      readInFlightRef.current = false;
    }
  }, [inquiryId, accessToken]);

  // Target the highest displayed committed sequence; never re-send a cursor the
  // backend already acknowledged.
  useEffect(() => {
    const highest = latestSequence(messages);
    if (highest <= 0) return;
    if (highest > targetReadRef.current) targetReadRef.current = highest;
    void flushRead();
  }, [messages, flushRead]);

  const { live, fallbackReason } = useMessagingRealtime({
    inquiryId,
    onNotify: (notification) => {
      if (notification.type === "resync") {
        scheduleCatchUp();
        return;
      }
      if (notification.type === "subscribed") {
        // Room joined (or rejoined after reconnect): reconcile + retry read.
        scheduleCatchUp();
        void flushRead();
        return;
      }
      // Ignore events for any other conversation.
      if (notification.payload.inquiryId !== inquiryId) return;
      // Drop duplicate deliveries of the same event.
      if (!eventCacheRef.current.remember(notification.payload.eventId)) return;
      scheduleCatchUp();
    },
  });

  const manualRefresh = () => {
    setActionError(null);
    scheduleCatchUp();
    void flushRead();
  };

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const evaluated = evaluateMessage(draft);
    if (!evaluated.valid || sending) return;
    setSendError(null);
    setSending(true);
    try {
      const sent = await sendInquiryMessage(
        inquiryId,
        evaluated.trimmed,
        accessToken ?? undefined
      );
      threadRef.current = applyThreadPage(threadRef.current, {
        messages: [sent],
        pageInfo: {
          afterSequence: threadRef.current.cursor,
          nextCursor: sent.sequence,
          hasMore: false,
        },
      });
      setMessages(threadRef.current.messages);
      setDraft("");
    } catch (error) {
      if (error instanceof ApiError) {
        setSendError({
          code: error.code,
          message: error.message,
          retryAfter: error.retryAfterSeconds,
        });
      } else {
        setSendError({
          code: "UNKNOWN",
          message: toErrorMessage(error),
          retryAfter: null,
        });
      }
    } finally {
      setSending(false);
    }
  };

  const doClose = async () => {
    setActionError(null);
    setBusyAction("close");
    try {
      await closeInquiryRequest(inquiryId, accessToken ?? undefined);
      setConfirmingClose(false);
      scheduleCatchUp();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
    } finally {
      setBusyAction(null);
    }
  };

  const toggleArchive = async () => {
    if (!inquiry) return;
    setActionError(null);
    setBusyAction("archive");
    try {
      const result = await setInquiryArchived(
        inquiryId,
        !inquiry.archived,
        accessToken ?? undefined
      );
      setInquiry((current) =>
        current ? { ...current, archived: result.archived } : current
      );
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
    } finally {
      setBusyAction(null);
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (phase === "not_found") {
    return (
      <EmptyState
        icon={SearchX}
        title="Conversation not found"
        description="This conversation may have been removed, or you don't have access to it."
        action={<ButtonLink href="/messages">Back to messages</ButtonLink>}
      />
    );
  }

  if (phase === "error" || !inquiry) {
    return (
      <ErrorState
        title="We couldn't load this conversation"
        message={loadError ?? "Please try again."}
        action={
          <Button variant="outline" onClick={manualRefresh}>
            Try again
          </Button>
        }
      />
    );
  }

  const isClosed = inquiry.status === "closed";
  const counterpartName = inquiry.counterpart?.displayName ?? "MediCN member";
  const evaluated = evaluateMessage(draft);
  const isSendRateLimited =
    sendError?.code === "RATE_LIMITED" || sendError?.code === "RATE_LIMIT_EXCEEDED";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">
              {counterpartName}
            </h1>
            {isClosed && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                Closed
              </span>
            )}
            {inquiry.archived && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Archived
              </span>
            )}
          </div>
          <Link
            href={`/listings/${inquiry.listing.id}`}
            className="truncate text-sm text-slate-600 underline-offset-4 hover:underline"
          >
            {inquiry.listing.title} · {inquiry.listing.city}
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={manualRefresh}
            aria-label="Refresh conversation"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleArchive}
            disabled={busyAction !== null}
          >
            {inquiry.archived ? (
              <>
                <ArchiveRestore aria-hidden="true" />
                Unarchive
              </>
            ) : (
              <>
                <Archive aria-hidden="true" />
                Archive
              </>
            )}
          </Button>
          {!isClosed && !confirmingClose && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingClose(true)}
            >
              <Lock aria-hidden="true" />
              Close
            </Button>
          )}
        </div>
      </div>

      {confirmingClose && !isClosed && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <span className="text-sm font-medium text-amber-900">
            Close this conversation? This is permanent and can&apos;t be undone.
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={doClose}
            disabled={busyAction !== null}
          >
            {busyAction === "close" ? "Closing…" : "Yes, close"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingClose(false)}
            disabled={busyAction !== null}
          >
            Keep open
          </Button>
        </div>
      )}

      {/* Close/archive errors stay visible independently of the composer. */}
      {actionError && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      {!live && (
        <p className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          {fallbackReason === "rate_limited"
            ? "Live updates are paused for a moment. Messages still send, and Refresh loads the latest."
            : "Live updates are unavailable. Messages still send, and Refresh loads the latest."}
        </p>
      )}

      {loadError && (
        <p role="alert" className="text-sm text-red-700">
          {loadError}
        </p>
      )}

      {readError && (
        <p className="text-xs text-slate-500">
          We couldn&apos;t sync your read status. It will retry automatically.
        </p>
      )}

      <ul className="flex flex-col gap-3" aria-live="polite">
        {messages.length === 0 && (
          <li className="text-sm text-slate-500">No messages yet.</li>
        )}
        {messages.map((message) => {
          const isSelf = message.sender.id === user?.id;
          return (
            <li
              key={message.id}
              className={isSelf ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`flex max-w-[85%] flex-col gap-1 rounded-xl px-3 py-2 ${
                  isSelf
                    ? "bg-sky-600 text-white"
                    : message.isAdmin
                      ? "border border-amber-200 bg-amber-50 text-slate-900"
                      : "bg-slate-100 text-slate-900"
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-xs ${
                    isSelf ? "text-sky-100" : "text-slate-500"
                  }`}
                >
                  <span className="font-medium">
                    {isSelf ? "You" : message.sender.displayName}
                  </span>
                  {message.isAdmin && (
                    <span className="rounded-full bg-amber-200 px-1.5 text-[0.65rem] font-semibold text-amber-900">
                      MediCN
                    </span>
                  )}
                  <span>· {formatTime(message.createdAt)}</span>
                </span>
                <span className="whitespace-pre-line break-words text-sm">
                  {message.body}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {isClosed ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          This conversation is closed. You can still read it, but new messages
          can&apos;t be sent.
        </p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-2" aria-label="Send a message">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            id="message-body"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {sendError && (
            <div
              role="alert"
              className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <CircleAlert className="size-4" aria-hidden="true" />
                {sendError.message}
              </p>
              {isSendRateLimited ? (
                <p className="text-xs text-red-700">
                  You&apos;re sending messages quickly.{" "}
                  {sendError.retryAfter
                    ? `Try again in about ${sendError.retryAfter}s.`
                    : "Please wait a moment and try again."}
                </p>
              ) : (
                messageErrorHint(sendError.code) && (
                  <p className="text-xs text-red-700">
                    {messageErrorHint(sendError.code)}
                  </p>
                )
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`text-xs ${
                evaluated.tooLong ? "text-red-600" : "text-slate-500"
              }`}
            >
              {evaluated.tooLong
                ? `${Math.abs(evaluated.remaining)} characters over the limit`
                : `${evaluated.remaining} characters left`}
            </span>
            <Button type="submit" disabled={sending || !evaluated.valid}>
              <Send aria-hidden="true" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
