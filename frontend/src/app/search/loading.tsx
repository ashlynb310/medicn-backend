export default function SearchLoading() {
  return (
    <div
      role="status"
      aria-label="Loading listings"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-48 w-full animate-pulse rounded-xl bg-slate-100" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-xl bg-slate-100"
          />
        ))}
      </div>
    </div>
  );
}
