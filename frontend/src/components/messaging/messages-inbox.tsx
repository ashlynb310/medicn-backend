"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageOff, MessagesSquare } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { useAuth } from "@/components/auth/auth-provider";
import { useMessagingRealtime } from "@/components/messaging/use-messaging-realtime";
import { listInquiries } from "@/lib/api/messaging";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import { avatarColorClass, avatarInitials } from "@/lib/avatar";
import type {
  InquiryListMeta,
  InquiryStatus,
  InquirySummary,
} from "@/lib/api/types";

const PAGE_SIZE = 20;
const REFRESH_DEBOUNCE_MS = 400;

type State =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "ready"; inquiries: InquirySummary[]; meta: InquiryListMeta };

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = new Date().toDateString() === date.toDateString();
  return date.toLocaleString(
    "en-US",
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" }
  );
}

function isHttpUrl(url: string | null): url is string {
  return !!url && (url.startsWith("https://") || url.startsWith("http://"));
}

export default function MessagesInbox() {
  const { accessToken } = useAuth();
  // Status and archived are INDEPENDENT, explicit controls: switching to the
  // archived view never hides which status filter is applied.
  const [status, setStatus] = useState<InquiryStatus>("open");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<State>({ status: "loading" });

  const requestRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    // Abort any in-flight list request so a stale response can't overwrite.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    listInquiries(
      { status, archived, page, limit: PAGE_SIZE },
      accessToken ?? undefined,
      controller.signal
    )
      .then(({ inquiries, meta }) =>
        setState({ status: "ready", inquiries, meta })
      )
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError) {
          setState({ status: "error", code: error.code, message: error.message });
        } else {
          setState({
            status: "error",
            code: "UNKNOWN",
            message: toErrorMessage(error),
          });
        }
      });
  }, [accessToken, status, archived, page]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  // Refresh the visible inbox when relevant notifications arrive, coalescing
  // bursts into a single reload.
  useMessagingRealtime({
    onNotify: (notification) => {
      if (notification.type === "subscribed") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
    },
  });

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const changeStatus = (next: InquiryStatus) => {
    setState({ status: "loading" });
    setStatus(next);
    setPage(1);
  };

  const toggleArchived = () => {
    setState({ status: "loading" });
    setArchived((current) => !current);
    setPage(1);
  };

  const goToPage = (next: number) => {
    setState({ status: "loading" });
    setPage(next);
  };

  const retry = () => {
    setState({ status: "loading" });
    load();
  };

  const totalPages =
    state.status === "ready"
      ? Math.max(1, Math.ceil(state.meta.total / state.meta.limit))
      : 1;

  const tabClass = (active: boolean) =>
    active
      ? "border-b-2 border-sky-600 px-3 py-2 text-sm font-semibold text-sky-700"
      : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div role="tablist" aria-label="Conversation status" className="flex flex-wrap">
          <button
            type="button"
            role="tab"
            aria-selected={status === "open"}
            className={tabClass(status === "open")}
            onClick={() => changeStatus("open")}
          >
            Open
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={status === "closed"}
            className={tabClass(status === "closed")}
            onClick={() => changeStatus("closed")}
          >
            Closed
          </button>
        </div>
        <Button
          variant={archived ? "secondary" : "outline"}
          size="sm"
          aria-pressed={archived}
          onClick={toggleArchived}
          className="mb-1"
        >
          {archived ? "Showing archived" : "Show archived"}
        </Button>
      </div>

      {state.status === "loading" && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {state.status === "error" &&
        (state.code === "FORBIDDEN" ? (
          <ErrorState
            title="You can't view these messages"
            message="This account doesn't have access to this inbox."
          />
        ) : (
          <ErrorState
            title="We couldn't load your messages"
            message={state.message}
            action={
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            }
          />
        ))}

      {state.status === "ready" && state.inquiries.length === 0 && (
        <EmptyState
          icon={MessagesSquare}
          title={
            archived
              ? `No archived ${status} conversations`
              : status === "open"
                ? "No open conversations"
                : "No closed conversations"
          }
          description={
            archived
              ? "Conversations you archive will appear here."
              : status === "open"
                ? "Message a host from a listing to start a conversation."
                : "Conversations that have been closed will appear here."
          }
          action={
            !archived && status === "open" ? (
              <ButtonLink href="/search">Browse listings</ButtonLink>
            ) : undefined
          }
        />
      )}

      {state.status === "ready" && state.inquiries.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {state.inquiries.map((inquiry) => {
              const name = inquiry.counterpart?.displayName ?? "MediCN member";
              const photo = inquiry.counterpart?.profilePhotoUrl ?? null;
              return (
                <li key={inquiry.id}>
                  <Link
                    href={`/messages/${inquiry.id}`}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white ${
                        isHttpUrl(photo) ? "bg-slate-100" : avatarColorClass(name)
                      }`}
                    >
                      {isHttpUrl(photo) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
                        <img src={photo} alt="" className="size-full object-cover" />
                      ) : (
                        avatarInitials(name)
                      )}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-slate-900">
                          {name}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {formatTimestamp(inquiry.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-slate-600">
                        {isHttpUrl(inquiry.listing.photoUrl) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- backend storage host is env-dependent
                          <img
                            src={inquiry.listing.photoUrl}
                            alt=""
                            className="size-4 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <ImageOff className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">
                          {inquiry.listing.title} · {inquiry.listing.city}
                        </span>
                      </span>
                      {inquiry.lastMessagePreview && (
                        <span className="truncate text-sm text-slate-700">
                          {inquiry.lastMessagePreview}
                        </span>
                      )}
                    </span>

                    {inquiry.unreadCount > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-semibold text-white"
                        aria-label={`${inquiry.unreadCount} unread messages`}
                      >
                        {inquiry.unreadCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="Conversation pages"
              className="flex items-center justify-center gap-4"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {state.meta.page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
