import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional action node, e.g. a Button or Link styled as a button. */
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center",
        className
      )}
    >
      <Icon className="size-10 text-slate-400" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description && (
        <p className="max-w-md text-sm text-slate-600">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
