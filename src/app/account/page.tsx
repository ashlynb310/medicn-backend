"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Save, ShieldCheck } from "lucide-react";
import SignInRequired from "@/components/auth/sign-in-required";
import { useAuth } from "@/components/auth/auth-provider";
import ProfilePhotoUpload from "@/components/auth/profile-photo-upload";
import FormField from "@/components/form/form-field";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import ErrorState from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CurrentUser,
  HealthcareRole,
  UpdateCurrentUserInput,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { formatEnumLabel } from "@/lib/listing-format";

const healthcareRoleItems: Record<string, string> = {
  not_selected: "Not specified",
  medical_student: "Medical student",
  nursing_student: "Nursing student",
  nurse: "Nurse",
  resident_physician: "Resident physician",
  physician: "Physician",
  other: "Other",
};

type ProfileFormValues = {
  firstName: string;
  lastName: string;
  displayName: string;
  healthcareRole: HealthcareRole | "";
  healthcareAffiliation: string;
  phoneNumber: string;
  bio: string;
};

type FieldName = keyof ProfileFormValues;
type FieldErrors = Partial<Record<FieldName, string>>;

function toFormValues(user: CurrentUser): ProfileFormValues {
  return {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    displayName: user.displayName ?? "",
    healthcareRole: user.healthcareRole ?? "",
    healthcareAffiliation: user.healthcareAffiliation ?? "",
    phoneNumber: user.phoneNumber ?? "",
    bio: user.bio ?? "",
  };
}

function toNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function validate(values: ProfileFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (values.firstName.trim().length > 100) {
    errors.firstName = "Use 100 characters or fewer.";
  }
  if (values.lastName.trim().length > 100) {
    errors.lastName = "Use 100 characters or fewer.";
  }
  if (values.displayName.trim().length > 100) {
    errors.displayName = "Use 100 characters or fewer.";
  }
  if (values.healthcareAffiliation.trim().length > 200) {
    errors.healthcareAffiliation = "Use 200 characters or fewer.";
  }
  if (values.phoneNumber.trim().length > 40) {
    errors.phoneNumber = "Use 40 characters or fewer.";
  }
  if (values.bio.trim().length > 1000) {
    errors.bio = "Use 1,000 characters or fewer.";
  }
  return errors;
}

function toPayload(values: ProfileFormValues): UpdateCurrentUserInput {
  return {
    firstName: toNullableText(values.firstName),
    lastName: toNullableText(values.lastName),
    displayName: toNullableText(values.displayName),
    healthcareRole: values.healthcareRole || null,
    healthcareAffiliation: toNullableText(values.healthcareAffiliation),
    phoneNumber: toNullableText(values.phoneNumber),
    bio: toNullableText(values.bio),
  };
}

export default function AccountPage() {
  const router = useRouter();
  const {
    status,
    user,
    profileStatus,
    email,
    signOut,
    refreshProfile,
    updateProfile,
  } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      void refreshProfile();
    }
  }, [status, refreshProfile]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  if (status === "loading") {
    return (
      <PageContainer width="narrow">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }

  if (status !== "authenticated") {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Your profile" />
        <SignInRequired
          message="Sign in to view and update your MediCN profile."
          returnTo="/account"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Your profile"
        description="Keep your MediCN account details current."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/account/verification" variant="outline">
              <ShieldCheck aria-hidden="true" />
              Verification
            </ButtonLink>
            <Button variant="outline" onClick={handleSignOut}>
              Log out
            </Button>
          </div>
        }
      />

      {profileStatus === "error" ? (
        <ErrorState
          title="Profile unavailable"
          message="You are signed in, but we could not load your MediCN profile. The API may be offline."
          action={
            <Button variant="outline" onClick={() => void refreshProfile()}>
              Retry
            </Button>
          }
        />
      ) : profileStatus === "loading" || !user ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <ProfileEditor
          key={user.id}
          user={user}
          email={email}
          onSave={updateProfile}
        />
      )}
    </PageContainer>
  );
}

function ProfileEditor({
  user,
  email,
  onSave,
}: {
  user: CurrentUser;
  email: string | null;
  onSave: (input: UpdateCurrentUserInput) => Promise<CurrentUser>;
}) {
  const [values, setValues] = useState<ProfileFormValues>(() =>
    toFormValues(user)
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(
    () =>
      JSON.stringify(toPayload(values)) !==
      JSON.stringify(toPayload(toFormValues(user))),
    [user, values]
  );

  const updateValue = (field: FieldName, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
    setSaved(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;

    const nextErrors = validate(values);
    setFieldErrors(nextErrors);
    setFormError(null);
    setSaved(false);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSaving(true);
    try {
      const updated = await onSave(toPayload(values));
      setValues(toFormValues(updated));
      setSaved(true);
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "We could not save your profile. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {user.roles.length > 0 ? (
            user.roles.map((role) => (
              <Badge key={role} tone="info">
                {formatEnumLabel(role)}
              </Badge>
            ))
          ) : (
            <Badge tone="neutral">No role assigned</Badge>
          )}
          {user.emailVerified ? (
            <Badge tone="success">Email verified</Badge>
          ) : (
            <Badge tone="warning">Email not verified</Badge>
          )}
        </div>
        <p className="text-sm text-slate-600">{email ?? "Email unavailable"}</p>
        {!user.emailVerified && (
          <div
            className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            role="status"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Confirm your email before requesting a booking or completing
              payment. You can still finish your profile while it is
              unconfirmed.
            </p>
          </div>
        )}
      </section>

      <ProfilePhotoUpload
        currentPhotoUrl={user.profilePhotoUrl}
        fallbackLabel={user.displayName || user.firstName || email || "Account"}
      />

      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-6"
        aria-label="Edit profile"
      >
        <section className="flex flex-col gap-5 rounded-lg border border-slate-200 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Profile details
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              This information is visible where MediCN uses your profile.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="First name" error={fieldErrors.firstName}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={values.firstName}
                  maxLength={100}
                  onChange={(event) => updateValue("firstName", event.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={!!fieldErrors.firstName}
                  autoComplete="given-name"
                />
              )}
            </FormField>
            <FormField label="Last name" error={fieldErrors.lastName}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={values.lastName}
                  maxLength={100}
                  onChange={(event) => updateValue("lastName", event.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={!!fieldErrors.lastName}
                  autoComplete="family-name"
                />
              )}
            </FormField>
          </div>

          <FormField label="Display name" error={fieldErrors.displayName}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                value={values.displayName}
                maxLength={100}
                onChange={(event) => updateValue("displayName", event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={!!fieldErrors.displayName}
                autoComplete="nickname"
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Healthcare role">
              {({ id }) => (
                <Select
                  items={healthcareRoleItems}
                  value={values.healthcareRole || "not_selected"}
                  onValueChange={(value) =>
                    updateValue(
                      "healthcareRole",
                      value === "not_selected" ? "" : value ?? ""
                    )
                  }
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(healthcareRoleItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Phone number" error={fieldErrors.phoneNumber}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="tel"
                  value={values.phoneNumber}
                  maxLength={40}
                  onChange={(event) => updateValue("phoneNumber", event.target.value)}
                  aria-describedby={describedBy}
                  aria-invalid={!!fieldErrors.phoneNumber}
                  autoComplete="tel"
                />
              )}
            </FormField>
          </div>

          <FormField
            label="Healthcare affiliation"
            error={fieldErrors.healthcareAffiliation}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                value={values.healthcareAffiliation}
                maxLength={200}
                onChange={(event) =>
                  updateValue("healthcareAffiliation", event.target.value)
                }
                aria-describedby={describedBy}
                aria-invalid={!!fieldErrors.healthcareAffiliation}
              />
            )}
          </FormField>

          <FormField
            label="About you"
            hint="Up to 1,000 characters."
            error={fieldErrors.bio}
          >
            {({ id, describedBy }) => (
              <textarea
                id={id}
                rows={5}
                value={values.bio}
                maxLength={1000}
                onChange={(event) => updateValue("bio", event.target.value)}
                aria-describedby={describedBy}
                aria-invalid={!!fieldErrors.bio}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
              />
            )}
          </FormField>
        </section>

        {formError && (
          <div
            className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{formError}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSaving || !isDirty}>
            <Save aria-hidden="true" />
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
          {saved ? (
            <span
              className="flex items-center gap-1.5 text-sm text-green-700"
              role="status"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Profile saved
            </span>
          ) : isDirty ? (
            <span className="text-sm text-slate-600">Unsaved changes</span>
          ) : (
            <span className="text-sm text-slate-500">
              Your profile is up to date
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
