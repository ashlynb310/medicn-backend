'use client';

import { Input } from "@/components/ui/input";

interface SearchInputProps {
    onSubmit: (e: React.SubmitEvent<HTMLFormElement>) => void;
}

export default function SearchInput({ onSubmit}: SearchInputProps) {
    return (
        <form onSubmit={onSubmit} className="mt-10 flex w-full max-w-md gap-2">
            <div className="relative w-full">
                <Input
                    type="text"
                    name="searchQuery"
                    placeholder="Search by city or zip code..."
                    className="bg-white text-slate-900 pl-4 pr-10 py-6 rounded-xl border-transparent placeholder-slate-400 focus-visible:ring-2 focus-visible:ring-slate-400"
                />
                <button
                    type="submit"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                    aria-label="Submit Search"
                >
                    🔍
                </button>
            </div>
        </form>
    )
}