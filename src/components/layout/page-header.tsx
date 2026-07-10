interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional actions (buttons, links) shown on the right of the title. */
  actions?: React.ReactNode;
  /** Optional element rendered above the title, e.g. a back link or breadcrumb. */
  eyebrow?: React.ReactNode;
}

export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-6">
      {eyebrow && <div className="text-sm text-slate-500">{eyebrow}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm text-slate-600">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
