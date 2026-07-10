import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  /** Render prop receives the id to wire to the control's `id`/`htmlFor`. */
  children: (props: { id: string; describedBy?: string }) => React.ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

/**
 * Wraps a form control with a label, optional hint, and error message, keeping
 * ids and aria wiring consistent across forms. Works with the base-ui Input,
 * Select, etc. via the render-prop `id`.
 */
export default function FormField({
  label,
  children,
  hint,
  error,
  required,
  className,
}: FormFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
