"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { acquireMessagingSocket } from "@/lib/realtime/messaging-socket";
import {
  createConnectionGeneration,
  resolveRealtimeStatus,
  type FallbackReason,
  type RealtimeConnectionStatus,
} from "@/lib/realtime/connection-identity";
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

export type { FallbackReason };

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
  // Opaque per-connection identity: a fresh, empty object is minted whenever the
  // token or room changes. ONLY this object is stored in status — the access
  // token is never copied into state, hashed, interpolated, rendered, or
  // persisted; it goes solely to the socket manager to build the handshake.
  const generation = useMemo(
    () => createConnectionGeneration(),
    // The token and room ARE the connection identity, so they belong in this
    // dependency list even though the factory deliberately ignores them: a
    // change must mint a new opaque generation. Nothing about them is retained.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, inquiryId]
  );
  const [status, setStatus] = useState<RealtimeConnectionStatus>(() => ({
    generation,
    live: false,
    reason: "connecting",
  }));
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

    // `disposed` guards against writes from an effect run that has already been
    // cleaned up; the generation tag makes any such write inert at render time.
    const goLive = () => {
      if (disposed) return;
      setStatus({ generation, live: true, reason: null });
    };
    const goFallback = (reason: FallbackReason) => {
      if (disposed) return;
      setStatus({ generation, live: false, reason });
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
  }, [accessToken, inquiryId, generation]);

  // Status from a previous generation (rotated token or changed room) resolves
  // immediately to a non-live "connecting" state during this very render.
  return resolveRealtimeStatus(status, generation);
}
