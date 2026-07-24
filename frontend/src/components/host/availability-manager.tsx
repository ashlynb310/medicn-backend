"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import { useAuth } from "@/components/auth/auth-provider";
import {
  createAvailabilityWindow,
  deleteAvailabilityWindow,
  getHostListingCalendar,
  listAvailabilityWindows,
  updateAvailabilityWindow,
} from "@/lib/api/availability";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import type {
  AvailabilityListMeta,
  ListingAvailabilityStatus,
  ListingAvailabilityWindow,
  ReservedCalendarRange,
} from "@/lib/api/types";
import { formatDate } from "@/lib/listing-format";
import { addDays, todayInTimeZone } from "@/lib/civil-date";

const PAGE_SIZE = 50;

const statusItems: Record<string, string> = {
  available: "Available",
  blocked: "Blocked",
};

type WindowsState =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | {
      status: "ready";
      windows: ListingAvailabilityWindow[];
      meta: AvailabilityListMeta;
    };

function StatusBadge({ status }: { status: ListingAvailabilityStatus }) {
  return status === "available" ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Available
    </span>
  ) : (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      Blocked
    </span>
  );
}

export default function AvailabilityManager({
  listingId,
  timeZone,
}: {
  listingId: string;
  timeZone: string;
}) {
  const { accessToken } = useAuth();
  const today = todayInTimeZone(timeZone);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<WindowsState>({ status: "loading" });
  const [reservations, setReservations] = useState<ReservedCalendarRange[]>([]);
  const [reservationsError, setReservationsError] = useState<string | null>(null);

  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newStatus, setNewStatus] = useState<ListingAvailabilityStatus>("available");
  const [creating, setCreating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyWindowId, setBusyWindowId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editStatus, setEditStatus] = useState<ListingAvailabilityStatus>("available");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadWindows = useCallback(
    (signal?: AbortSignal) => {
      listAvailabilityWindows(
        listingId,
        { page, limit: PAGE_SIZE },
        accessToken ?? undefined,
        signal
      )
        .then(({ windows, meta }) =>
          setState({ status: "ready", windows, meta })
        )
        .catch((error) => {
          if (signal?.aborted) return;
          if (error instanceof ApiError) {
            setState({
              status: "error",
              code: error.code,
              message: error.message,
            });
          } else {
            setState({ status: "error", code: "UNKNOWN", message: toErrorMessage(error) });
          }
        });
    },
    [listingId, page, accessToken]
  );

  const loadReservations = useCallback(
    (signal?: AbortSignal) => {
      const start = todayInTimeZone(timeZone);
      // Stay within the backend 366-day bound.
      const end = addDays(start, 365);
      getHostListingCalendar(
        listingId,
        { startDate: start, endDate: end },
        accessToken ?? undefined,
        signal
      )
        .then((calendar) => {
          setReservations(calendar.reservations);
          setReservationsError(null);
        })
        .catch((error) => {
          if (signal?.aborted) return;
          setReservationsError(toErrorMessage(error));
        });
    },
    [listingId, accessToken, timeZone]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadWindows(controller.signal);
    return () => controller.abort();
  }, [loadWindows]);

  useEffect(() => {
    const controller = new AbortController();
    loadReservations(controller.signal);
    return () => controller.abort();
  }, [loadReservations]);

  const reload = () => {
    loadWindows();
    loadReservations();
  };

  const goToPage = (next: number) => {
    setState({ status: "loading" });
    setPage(next);
  };

  const retryWindows = () => {
    setState({ status: "loading" });
    loadWindows();
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMutationError(null);
    if (!newStart || !newEnd) {
      setMutationError("Choose a start and end date.");
      return;
    }
    if (newEnd <= newStart) {
      setMutationError("End date must be after the start date (checkout is exclusive).");
      return;
    }
    setCreating(true);
    try {
      await createAvailabilityWindow(
        listingId,
        { startDate: newStart, endDate: newEnd, status: newStatus },
        accessToken ?? undefined
      );
      setNewStart("");
      setNewEnd("");
      setNewStatus("available");
      reload();
    } catch (error) {
      setMutationError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (window: ListingAvailabilityWindow) => {
    setMutationError(null);
    setEditingId(window.id);
    setEditStart(window.startDate);
    setEditEnd(window.endDate);
    setEditStatus(window.status);
  };

  const saveEdit = async (windowId: string) => {
    setMutationError(null);
    if (!editStart || !editEnd) {
      setMutationError("Choose a start and end date.");
      return;
    }
    if (editEnd <= editStart) {
      setMutationError("End date must be after the start date (checkout is exclusive).");
      return;
    }
    setSavingEdit(true);
    try {
      await updateAvailabilityWindow(
        listingId,
        windowId,
        { startDate: editStart, endDate: editEnd, status: editStatus },
        accessToken ?? undefined
      );
      // Only reflect the change locally after the backend confirms it.
      setEditingId(null);
      reload();
    } catch (error) {
      setMutationError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const removeWindow = async (windowId: string) => {
    setMutationError(null);
    setBusyWindowId(windowId);
    try {
      await deleteAvailabilityWindow(listingId, windowId, accessToken ?? undefined);
      reload();
    } catch (error) {
      setMutationError(
        error instanceof ApiError ? error.message : toErrorMessage(error)
      );
    } finally {
      setBusyWindowId(null);
    }
  };

  const totalPages =
    state.status === "ready"
      ? Math.max(1, Math.ceil(state.meta.total / state.meta.limit))
      : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-5 text-slate-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-900">Availability</h2>
      </div>
      <p className="text-sm text-slate-600">
        Dates are half-open: the end date is the checkout day and is not itself
        blocked. If you add no available windows, the listing is open except for
        blocked dates and existing reservations.
      </p>

      {/* Add window */}
      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4"
        aria-label="Add availability window"
      >
        <h3 className="text-sm font-semibold text-slate-900">Add a window</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="avail-new-start">Start</Label>
            <Input
              id="avail-new-start"
              type="date"
              min={today}
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="avail-new-end">End (checkout)</Label>
            <Input
              id="avail-new-end"
              type="date"
              min={newStart || today}
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="avail-new-status">Status</Label>
            <Select
              items={statusItems}
              value={newStatus}
              onValueChange={(v) =>
                setNewStatus((v as ListingAvailabilityStatus) ?? "available")
              }
            >
              <SelectTrigger id="avail-new-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={creating} className="w-full justify-center">
              <Plus aria-hidden="true" />
              {creating ? "Adding…" : "Add window"}
            </Button>
          </div>
        </div>
        {mutationError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {mutationError}
          </div>
        )}
      </form>

      {/* Windows list */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Your windows</h3>

        {state.status === "loading" && (
          <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {state.status === "error" &&
          (state.code === "NOT_FOUND" ? (
            <ErrorState
              title="You can't manage this calendar"
              message="This listing was not found, or you don't have access to its availability."
            />
          ) : (
            <ErrorState
              title="We couldn't load availability"
              message={state.message}
              action={
                <Button variant="outline" onClick={retryWindows}>
                  Try again
                </Button>
              }
            />
          ))}

        {state.status === "ready" && state.windows.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
            No windows yet. Without any available windows, the listing is open
            except for blocked dates and reservations.
          </p>
        )}

        {state.status === "ready" && state.windows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {state.windows.map((window) =>
              editingId === window.id ? (
                <li
                  key={window.id}
                  className="rounded-lg border border-sky-300 bg-sky-50/40 px-3 py-3"
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`avail-edit-start-${window.id}`}>Start</Label>
                      <Input
                        id={`avail-edit-start-${window.id}`}
                        type="date"
                        min={today}
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`avail-edit-end-${window.id}`}>End (checkout)</Label>
                      <Input
                        id={`avail-edit-end-${window.id}`}
                        type="date"
                        min={editStart || today}
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`avail-edit-status-${window.id}`}>Status</Label>
                      <Select
                        items={statusItems}
                        value={editStatus}
                        onValueChange={(v) =>
                          setEditStatus((v as ListingAvailabilityStatus) ?? "available")
                        }
                      >
                        <SelectTrigger
                          id={`avail-edit-status-${window.id}`}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusItems).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-1">
                      <Button
                        size="sm"
                        disabled={savingEdit}
                        onClick={() => saveEdit(window.id)}
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingEdit}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </li>
              ) : (
                <li
                  key={window.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <StatusBadge status={window.status} />
                    <span className="font-medium text-slate-800">
                      {formatDate(window.startDate)} → {formatDate(window.endDate)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyWindowId !== null || editingId !== null}
                      onClick={() => startEdit(window)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busyWindowId !== null || editingId !== null}
                      onClick={() => removeWindow(window.id)}
                      aria-label="Delete window"
                    >
                      <Trash2 className="size-4 text-red-600" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              )
            )}
          </ul>
        )}

        {state.status === "ready" && totalPages > 1 && (
          <nav aria-label="Availability pages" className="flex items-center justify-center gap-4">
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
      </div>

      {/* Reservations: read-only and opaque. */}
      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Lock className="size-4" aria-hidden="true" />
          Reserved dates (read-only)
        </h3>
        <p className="text-sm text-slate-600">
          These ranges are reserved by bookings and can&apos;t be edited here.
        </p>
        {reservationsError ? (
          <p className="text-sm text-slate-500">
            Reserved dates are unavailable right now.
          </p>
        ) : reservations.length === 0 ? (
          <p className="text-sm text-slate-500">No reserved dates in the next year.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reservations.map((range, index) => (
              <li
                key={`${range.startDate}-${range.endDate}-${index}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-700">
                  {formatDate(range.startDate)} → {formatDate(range.endDate)}
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Reserved
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
