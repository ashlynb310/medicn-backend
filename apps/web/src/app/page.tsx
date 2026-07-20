import Link from "next/link";

export default function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">MediCN Auth Shell</h1>
      <p className="max-w-2xl text-slate-700">
        Minimal frontend surface for Supabase sign-in and backend auth endpoint
        testing.
      </p>
      <Link
        className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        href="/dashboard"
      >
        Open dashboard
      </Link>
    </section>
  );
}
