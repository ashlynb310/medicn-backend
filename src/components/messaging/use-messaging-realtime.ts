"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { acquireMessagingSocket } from "@/lib/realtime/messaging-socket";
import type {
  InquiryClosedEvent,
  InquiryUpdatedEvent,
  MessageCreatedEvent,
  UnreadChangedEvent,
} from "@/lib/api/types";

export type RealtimeNotification =
  | { type: "resync" }
  | { type: "subscribed"; inquiryId: string }
  | { type: "message.created"; payload: MessageCreatedEvent }
  | { type: "inquiry.updated"; payload: InquiryUpdatedEvent }
  | { type: "inquiry.closed"; payload: InquiryClosedEvent }
  | { type: "unread.changed"; payload: UnreadChangedEvent };

/** Why realtime is not live. Never exposes provider or token detail. */
export type FallbackReason =
  | "connecting"
  | "disconnected"
  | "unavailable"
  | "rate_limited"
  | "timeout";

interface SubscribeAck {
  ok?: boolean;
  error?: { code?: string } | null;
}

const SUBSCRIBE_TIMEOUT_MS = 8_000;

/**
 * Subscribes to /messaging notifications for an optional inquiry room.
 *
 * The thread is treated as LIVE only after the socket connects AND the backend
 * acknowledges `inquiry.subscribe`. Timeout, NOT_FOUND, and rate-limit
 * acknowledgements all degrade to REST fallback. Notifications are hints only —
 * the caller reconciles through REST, and a `subscribed`/`resync` notification
 * asks it to do exactly that after (re)connect or token rotation.
 */
export function useMessagingRealtime({
  inquiryId,
  onNotify,
}: {
  inquiryId?: string | null;
  onNotify: (notification: RealtimeNotification) => void;
}): { live: boolean; fallbackReason: FallbackReason | null } {
  const { accessToken } = useAuth();
  // Connection identity: a changed token or room is a DIFFERENT connection, so
  // any status recorded for a previous one is discarded during render. This
  // resets to "connecting" immediately, without briefly retaining the old
  // room/token's live state and without setting state inside an effect.
  const connectionKey = `${accessToken ?? ""}|${inquiryId ?? ""}`;
  const [status, setStatus] = useState<{
    key: string;
    live: boolean;
    reason: FallbackReason | null;
  }>({ key: connectionKey, live: false, reason: "connecting" });
  const notifyRef = useRef(onNotify);

  useEffect(() => {
    notifyRef.current = onNotify;
  });

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    // Reference-counted shared socket; a rotated token yields a new instance.
    const handle = acquireMessagingSocket(accessToken);
    const socket = handle.socket;
    let disposed = false;

    // Status writes carry this connection's key; a late write from a replaced
    // connection is ignored at render time.
    const goLive = () => {
      if (disposed) return;
      setStatus({ key: connectionKey, live: true, reason: null });
    };
    const goFallback = (reason: FallbackReason) => {
      if (disposed) return;
      setStatus({ key: connectionKey, live: false, reason });
    };

    const subscribe = () => {
      if (!inquiryId) {
        // No room to join (e.g. the unread badge): connected is enough.
        goLive();
        notifyRef.current({ type: "resync" });
        return;
      }
      socket
        .timeout(SUBSCRIBE_TIMEOUT_MS)
        .emit(
          "inquiry.subscribe",
          { inquiryId },
          (timeoutError: unknown, ack: SubscribeAck | undefined) => {
            if (disposed) return;
            if (timeoutError) {
              goFallback("timeout");
              return;
            }
            if (ack?.ok) {
              goLive();
              // Room joined — reconcile immediately via serialized REST catch-up.
              notifyRef.current({ type: "subscribed", inquiryId });
              return;
            }
            const code = ack?.error?.code;
            goFallback(
              code === "RATE_LIMIT_EXCEEDED" || code === "RATE_LIMIT_UNAVAILABLE"
                ? "rate_limited"
                : "unavailable"
            );
          }
        );
    };

    const handleConnect = () => subscribe();
    const handleDown = () => goFallback("disconnected");

    const forward =
      (type: RealtimeNotification["type"]) => (payload: unknown) =>
        notifyRef.current({ type, payload } as RealtimeNotification);

    const onMessageCreated = forward("message.created");
    const onInquiryUpdated = forward("inquiry.updated");
    const onInquiryClosed = forward("inquiry.closed");
    const onUnreadChanged = forward("unread.changed");

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDown);
    socket.on("connect_error", handleDown);
    socket.on("message.created", onMessageCreated);
    socket.on("inquiry.updated", onInquiryUpdated);
    socket.on("inquiry.closed", onInquiryClosed);
    socket.on("unread.changed", onUnreadChanged);

    // Already-connected shared socket: subscribe on a microtask so the effect
    // body never sets state synchronously.
    if (socket.connected) queueMicrotask(subscribe);

    return () => {
      disposed = true;
      if (inquiryId && socket.connected) {
        socket.emit("inquiry.unsubscribe", { inquiryId });
      }
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDown);
      socket.off("connect_error", handleDown);
      socket.off("message.created", onMessageCreated);
      socket.off("inquiry.updated", onInquiryUpdated);
      socket.off("inquiry.closed", onInquiryClosed);
      socket.off("unread.changed", onUnreadChanged);
      handle.release();
    };
  }, [accessToken, inquiryId, connectionKey]);

  // Status from a previous token/room is never shown.
  const current =
    status.key === connectionKey
      ? status
      : { key: connectionKey, live: false, reason: "connecting" as const };

  return { live: current.live, fallbackReason: current.reason };
}
