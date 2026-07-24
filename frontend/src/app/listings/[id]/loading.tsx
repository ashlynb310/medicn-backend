export default function ListingDetailLoading() {
  return (
    <div
      role="status"
      aria-label="Loading listing"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      <div className="h-9 w-3/4 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-72 w-full animate-pulse rounded-xl bg-slate-100" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </div>
  );
}
