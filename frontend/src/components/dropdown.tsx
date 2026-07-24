// src/app/dropdown.tsx
import Link from 'next/link';

export default function Dropdown() {
    return (
        <div className="relative group cursor-pointer py-2">
            <span className="text-slate-700 group-hover:text-black transition-colors flex items-center gap-1">
            Learn More <span className="text-xs">▼</span>
            </span>

            {/*Dropdown Menu Panel*/}
            
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block w-48 bg-white border border-slate-600 rounded-lg shadow-lg py-2 z-50">
                <Link href="/how-it-works" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                How It Works
                </Link>
                <Link href="/trust-and-safety" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                Trust and Safety
                </Link>
                <Link href="/blog" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                Our Blog | Between Rotations
                </Link>
                <Link href="/about" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                About Us
                </Link>
                <Link href="/faq" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                FAQ
                </Link>
                <Link href="/contact-us" className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                Contact Us
                </Link>
            </div>
        </div>
    )
}