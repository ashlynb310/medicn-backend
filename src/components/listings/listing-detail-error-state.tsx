import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ListingDetailErrorState({
  message,
}: {
  message: string;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-24 text-center"
    >
      <CircleAlert className="size-10 text-red-500" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-slate-900">
        We could not load this listing
      </h1>
      <p className="max-w-md text-sm text-slate-600">{message}</p>
      <Link href="/search" className={buttonVariants({ variant: "outline" })}>
        Back to search
      </Link>
    </div>
  );
}
