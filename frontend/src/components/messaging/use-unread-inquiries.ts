"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useMessagingRealtime } from "@/components/messaging/use-messaging-realtime";
import { listInquiries } from "@/lib/api/messaging";
import { aggregateUnread, totalPagesFor } from "@/lib/messaging/unread";

const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // bounded scan: up to 2,000 conversations
const REFRESH_DEBOUNCE_MS = 500;

/**
 * Real unread total for the signed-in user, aggregated across EVERY unarchived
 * inbox page. No `status` filter is sent, so both open and closed unarchived
 * conversations are counted. It refreshes (debounced) on realtime notifications.
 *
 * If the walk can't be completed — a failed request or the page budget being
 * exhausted — the previous backend-derived value is retained rather than
 * displaying a partial, invented total.
 */
export function useUnreadInquiries(): { total: number } {
  const { status, accessToken } = useAuth();
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useMessagingRealtime({
    onNotify: (notification) => {
      if (notification.type === "subscribed") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => setRefreshKey((key) => key + 1),
        REFRESH_DEBOUNCE_MS
      );
    },
  });

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    const token = accessToken ?? undefined;

    const load = async () => {
      const pages: Array<Array<{ unreadCount: number }>> = [];
      let complete = true;
      try {
        const first = await listInquiries(
          { archived: false, page: 1, limit: PAGE_LIMIT },
          token,
          controller.signal
        );
        pages.push(first.inquiries);
        const pageCount = totalPagesFor(first.meta.total, first.meta.limit);
        const readable = Math.min(pageCount, MAX_PAGES);
        if (pageCount > MAX_PAGES) complete = false;
        for (let page = 2; page <= readable; page += 1) {
          const next = await listInquiries(
            { archived: false, page, limit: PAGE_LIMIT },
            token,
            controller.signal
          );
          pages.push(next.inquiries);
        }
      } catch {
        complete = false;
      }
      if (controller.signal.aborted) return;
      const aggregated = aggregateUnread(pages, complete);
      // Never show a partial count; keep the last known-good total instead.
      if (aggregated.complete) setTotal(aggregated.total);
    };

    void load();
    return () => controller.abort();
  }, [status, accessToken, refreshKey]);

  return { total };
}
