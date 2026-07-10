import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  /** Current filter params to preserve when switching pages. */
  searchParams: Record<string, string>;
  basePath?: string;
}

function pageHref(
  basePath: string,
  searchParams: Record<string, string>,
  page: number
) {
  const params = new URLSearchParams(searchParams);
  if (page <= 1) {
    params.delete("page");
  } else {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export default function PaginationControls({
  page,
  totalPages,
  searchParams,
  basePath = "/search",
}: PaginationControlsProps) {
  if (totalPages <= 1) {
    return null;
  }

  const linkClass = buttonVariants({ variant: "outline" });
  const disabledClass = "pointer-events-none opacity-50";

  return (
    <nav
      aria-label="Search results pages"
      className="flex items-center justify-center gap-4"
    >
      <Link
        href={pageHref(basePath, searchParams, page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(linkClass, page <= 1 && disabledClass)}
      >
        <ChevronLeft aria-hidden="true" />
        Previous
      </Link>

      <span className="text-sm text-slate-600">
        Page {page} of {totalPages}
      </span>

      <Link
        href={pageHref(basePath, searchParams, page + 1)}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={cn(linkClass, page >= totalPages && disabledClass)}
      >
        Next
        <ChevronRight aria-hidden="true" />
      </Link>
    </nav>
  );
}
