"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import FormField from "@/components/form/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { createHealthcareVerification } from "@/lib/api/healthcare";
import type {
  HealthcareAffiliationType,
  HealthcareEvidenceCategory,
  HealthcareSubmission,
} from "@/lib/api/healthcare";
import type { HealthcareRole } from "@/lib/api/auth";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  healthcareErrorHint,
  validateAffiliationName,
} from "@/lib/healthcare/submission";

const roleItems: Record<string, string> = {
  medical_student: "Medical student",
  nursing_student: "Nursing student",
  nurse: "Nurse",
  resident_physician: "Resident physician",
  physician: "Physician",
  other: "Other",
};

const affiliationTypeItems: Record<string, string> = {
  hospital: "Hospital",
  clinic: "Clinic",
  university: "University",
  medical_school: "Medical school",
  nursing_school: "Nursing school",
  other: "Other",
};

const evidenceCategoryItems: Record<string, string> = {
  license: "Professional license",
  student: "Student enrollment",
  employment: "Employment",
  other: "Other",
};

const IDENTITY_CODES = new Set([
  "IDENTITY_VERIFICATION_REQUIRED",
  "IDENTITY_VERIFICATION_PENDING",
  "IDENTITY_VERIFICATION_REJECTED",
  "IDENTITY_VERIFICATION_EXPIRED",
]);

/**
 * Creates the next versioned claim. Exactly the four backend DTO fields are
 * sent. The backend's approved-identity check is authoritative — an identity
 * error here is surfaced honestly and never changes identity state.
 */
export default function HealthcareClaimForm({
  onCreated,
}: {
  onCreated: (submission: HealthcareSubmission) => void;
}) {
  const { accessToken } = useAuth();
  const [claimedRole, setClaimedRole] = useState<HealthcareRole>("physician");
  const [affiliationName, setAffiliationName] = useState("");
  const [affiliationType, setAffiliationType] =
    useState<HealthcareAffiliationType>("hospital");
  const [evidenceCategory, setEvidenceCategory] =
    useState<HealthcareEvidenceCategory>("license");

  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<{
    code: string;
    message: string;
    retryAfter: number | null;
  } | null>(null);

  const name = validateAffiliationName(affiliationName);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!name.valid) {
      setValidationError(
        "Enter the organization name (1 to 200 characters)."
      );
      return;
    }
    setValidationError(null);
    setError(null);
    setSubmitting(true);
    try {
      const created = await createHealthcareVerification(
        {
          claimedRole,
          claimedAffiliationName: name.trimmed,
          claimedAffiliationType: affiliationType,
          evidenceCategory,
        },
        accessToken ?? undefined
      );
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          code: err.code,
          message: err.message,
          retryAfter: err.retryAfterSeconds,
        });
      } else {
        setError({
          code: "UNKNOWN",
          message: toErrorMessage(err),
          retryAfter: null,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isRateLimited =
    error?.code === "RATE_LIMIT_EXCEEDED" || error?.code === "RATE_LIMITED";

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5"
      aria-label="Healthcare credential claim"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Start a credential submission
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Your role" required>
          {({ id }) => (
            <Select
              items={roleItems}
              value={claimedRole}
              onValueChange={(v) =>
                setClaimedRole((v as HealthcareRole) ?? "physician")
              }
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(roleItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        <FormField label="Organization type" required>
          {({ id }) => (
            <Select
              items={affiliationTypeItems}
              value={affiliationType}
              onValueChange={(v) =>
                setAffiliationType((v as HealthcareAffiliationType) ?? "hospital")
              }
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(affiliationTypeItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        label="Organization name"
        required
        error={validationError ?? undefined}
      >
        {({ id }) => (
          <Input
            id={id}
            value={affiliationName}
            onChange={(e) => setAffiliationName(e.target.value)}
            maxLength={200}
            placeholder="Houston Methodist Hospital"
          />
        )}
      </FormField>

      <FormField label="Evidence type" required>
        {({ id }) => (
          <Select
            items={evidenceCategoryItems}
            value={evidenceCategory}
            onValueChange={(v) =>
              setEvidenceCategory((v as HealthcareEvidenceCategory) ?? "license")
            }
          >
            <SelectTrigger id={id} className="w-full sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(evidenceCategoryItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="size-4" aria-hidden="true" />
            {error.message}
          </p>
          {isRateLimited ? (
            <p className="text-xs text-red-700">
              Too many attempts.{" "}
              {error.retryAfter
                ? `Try again in about ${error.retryAfter}s.`
                : "Please wait a moment and try again."}
            </p>
          ) : (
            healthcareErrorHint(error.code) && (
              <p className="text-xs text-red-700">
                {healthcareErrorHint(error.code)}
              </p>
            )
          )}
          {IDENTITY_CODES.has(error.code) && (
            <ButtonLink
              href="/account/verification"
              variant="outline"
              className="w-fit"
            >
              Go to identity verification
            </ButtonLink>
          )}
        </div>
      )}

      <Button type="submit" disabled={submitting} className="w-fit">
        {submitting ? "Creating…" : "Create submission"}
      </Button>
    </form>
  );
}
