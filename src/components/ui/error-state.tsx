import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  message: string;
  /** Optional action node, e.g. a retry Button or a Link. */
  action?: React.ReactNode;
  className?: string;
}

export default function ErrorState({
  title = "Something went wrong",
  message,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-16 text-center",
        className
      )}
    >
      <CircleAlert className="size-10 text-red-500" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-red-900">{title}</h2>
      <p className="max-w-md text-sm text-red-800">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
