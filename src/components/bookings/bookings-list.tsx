"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import BookingCard from "@/components/bookings/booking-card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { useAuth } from "@/components/auth/auth-provider";
import { listBookings } from "@/lib/api/bookings";
import { toErrorMessage } from "@/lib/api/client";
import type { Booking } from "@/lib/api/types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; bookings: Booking[] };

export default function BookingsList() {
  const { accessToken, user } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listBookings(accessToken ?? undefined, controller.signal)
      .then(({ bookings }) => setState({ status: "ready", bookings }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: toErrorMessage(error) });
      });
    return () => controller.abort();
  }, [accessToken, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title="We couldn't load your bookings"
        message={state.message}
        action={
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        }
      />
    );
  }

  if (state.bookings.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No bookings yet"
        description="When you request a stay from a listing, it will appear here so you can track its status."
        action={<ButtonLink href="/search">Browse listings</ButtonLink>}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {state.bookings.map((booking) => (
        <li key={booking.id}>
          <BookingCard booking={booking} currentUserId={user?.id} />
        </li>
      ))}
    </ul>
  );
}
