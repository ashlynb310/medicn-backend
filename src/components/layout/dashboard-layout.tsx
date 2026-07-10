"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DashboardNavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** When true, the link is active only on an exact path match. */
  exact?: boolean;
}

interface DashboardLayoutProps {
  /** Heading shown above the sidebar nav. */
  title: string;
  nav: DashboardNavItem[];
  children: React.ReactNode;
}

export default function DashboardLayout({
  title,
  nav,
  children,
}: DashboardLayoutProps) {
  const pathname = usePathname();

  const isActive = (item: DashboardNavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row">
      <aside className="lg:w-60 lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </p>
          <nav className="flex flex-col gap-1" aria-label={`${title} navigation`}>
            {nav.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
