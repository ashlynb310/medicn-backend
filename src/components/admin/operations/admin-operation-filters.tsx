"use client";

import { Filter, RotateCcw } from "lucide-react";
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
import type {
  AdminOperationFilterDraft,
  AdminOperationsListKind,
} from "./types";

const paymentStatuses = {
  any: "Any status",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  disputed: "Disputed",
};

const transferStatuses = {
  any: "Any status",
  pending: "Pending",
  processing: "Processing",
  transferred: "Transferred",
  failed: "Failed",
  blocked: "Blocked",
};

const reversalStatuses = {
  any: "Any reversal status",
  none: "None",
  pending: "Pending",
  processing: "Processing",
  partially_reversed: "Partially reversed",
  reversed: "Reversed",
  failed: "Failed",
};

const jobStates = {
  any: "Any state",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const queueNames = {
  any: "Any queue",
  email: "Email",
  media: "Media",
  maps: "Maps",
  operations: "Operations",
};

const jobScopes = {
  all: "All executions",
  failed: "Failed endpoint",
};

const commandTypes = {
  any: "Any command type",
  job_requeue: "Job requeue",
  payment_reconciliation: "Payment reconciliation",
  host_transfer_reconciliation: "Host transfer reconciliation",
};

const commandStatuses = {
  any: "Any status",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  partially_succeeded: "Partially succeeded",
  failed_retryable: "Failed - retryable",
  failed_permanent: "Failed - permanent",
};

function FilterSelect({
  id,
  label,
  items,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  items: Record<string, string>;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next ?? Object.keys(items)[0])}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function AdminOperationFilters({
  kind,
  draft,
  dateError,
  onChange,
  onApply,
  onReset,
}: {
  kind: AdminOperationsListKind;
  draft: AdminOperationFilterDraft;
  dateError: string | null;
  onChange: (draft: AdminOperationFilterDraft) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const set = <K extends keyof AdminOperationFilterDraft>(
    field: K,
    value: AdminOperationFilterDraft[K]
  ) => onChange({ ...draft, [field]: value });

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kind === "payments" && (
          <>
            <FilterSelect
              id="ops-payment-status"
              label="Payment status"
              items={paymentStatuses}
              value={draft.status}
              onChange={(value) => set("status", value)}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="ops-payment-booking">Booking ID</Label>
              <Input
                id="ops-payment-booking"
                value={draft.bookingId}
                onChange={(event) => set("bookingId", event.target.value)}
                placeholder="UUID"
              />
            </div>
          </>
        )}

        {kind === "transfers" && (
          <>
            <FilterSelect
              id="ops-transfer-status"
              label="Transfer status"
              items={transferStatuses}
              value={draft.status}
              onChange={(value) => set("status", value)}
            />
            <FilterSelect
              id="ops-reversal-status"
              label="Reversal status"
              items={reversalStatuses}
              value={draft.reversalStatus}
              onChange={(value) => set("reversalStatus", value)}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="ops-transfer-booking">Booking ID</Label>
              <Input
                id="ops-transfer-booking"
                value={draft.bookingId}
                onChange={(event) => set("bookingId", event.target.value)}
                placeholder="UUID"
              />
            </div>
          </>
        )}

        {kind === "jobs" && (
          <>
            <FilterSelect
              id="ops-job-scope"
              label="Endpoint"
              items={jobScopes}
              value={draft.jobScope}
              onChange={(value) => set("jobScope", value as "all" | "failed")}
            />
            <FilterSelect
              id="ops-job-state"
              label="State"
              items={jobStates}
              value={draft.state}
              disabled={draft.jobScope === "failed"}
              onChange={(value) => set("state", value)}
            />
            <FilterSelect
              id="ops-job-queue"
              label="Queue"
              items={queueNames}
              value={draft.queueName}
              onChange={(value) => set("queueName", value)}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="ops-job-type">Job type</Label>
              <Input
                id="ops-job-type"
                value={draft.jobType}
                onChange={(event) => set("jobType", event.target.value)}
                maxLength={100}
                placeholder="checkout_expiry"
              />
            </div>
          </>
        )}

        {kind === "commands" && (
          <>
            <FilterSelect
              id="ops-command-type"
              label="Command type"
              items={commandTypes}
              value={draft.commandType}
              onChange={(value) => set("commandType", value)}
            />
            <FilterSelect
              id="ops-command-status"
              label="Command status"
              items={commandStatuses}
              value={draft.status}
              onChange={(value) => set("status", value)}
            />
          </>
        )}

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ops-created-from">Created from</Label>
          <Input
            id="ops-created-from"
            type="datetime-local"
            value={draft.createdFrom}
            onChange={(event) => set("createdFrom", event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ops-created-to">Created to</Label>
          <Input
            id="ops-created-to"
            type="datetime-local"
            value={draft.createdTo}
            onChange={(event) => set("createdTo", event.target.value)}
          />
        </div>
      </div>

      {dateError && (
        <p role="alert" className="text-sm text-red-700">
          {dateError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          <Filter aria-hidden="true" />
          Apply filters
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
      </div>
    </form>
  );
}
