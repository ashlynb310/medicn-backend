import { CircleAlert } from "lucide-react";

export default function ListingSearchErrorState({
  message,
}: {
  message: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-16 text-center"
    >
      <CircleAlert className="size-10 text-red-500" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-red-900">
        We could not load listings
      </h2>
      <p className="max-w-md text-sm text-red-800">{message}</p>
    </div>
  );
}
