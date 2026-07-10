import Link from 'next/link';
import Image from 'next/image';

export default function Footer() {
    const columnOneLinks = [
        { label: 'About Us', href: '/about'},
        { label: 'Search Listings', href: '/search'},
        { label: 'Post A New Listing', href: '/host/listings/new'},
        { label: 'How It Works', href: '/how-it-works'},
        { label: 'Trust & Safety', href: '/trust-and-safety'}
    ];

    const columnTwoLinks = [
        { label: 'Our Blog | Between Rotations', href: '/blog'},
        { label: 'FAQ', href: '/faq'},
        { label: 'Terms of Service', href: '/terms-of-service'},
        { label: 'Privacy Policy', href: '/privacy-policy'},
        { label: 'Contact Us', href: '/contact-us'}
    ];

    return (
        <footer className="w-full border-t z-50 border-slate-200 bg-white px-6 py-16">
            <div className="mx-auto flex max-w-7xl flex-col justify-between gap-12 md:flex-row md:items-start">
                <div className="flex flex-col items-start max-w-sm">
                    <Link href="/" aria-label="Homepage" className="hover:opacity-80 transition-opacity">
                        <Image 
                        src="/600x600_Placeholder_Image.svg" 
                        alt="Company Logo"
                        width={150}
                        height={100}
                        className="h-10 w-auto"
                        />
                    </Link>

                    <p>
                        Your Community. Your Home. Your Network.
                    </p>

                    <div className="mt-6 flex items-center gap-5 text-slate-400">
                        {/* Facebook */}
                        <a 
                            href="https://facebook.com" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:opacity-70 transition-opacity" 
                            aria-label="Facebook Page"
                        >
                            <Image 
                            src="/socials/facebook-svgrepo-com.svg" 
                            alt="Facebook" 
                            width={20} 
                            height={20} 
                            className="h-5 w-5 object-contain" 
                            />
                        </a>

                        {/* Twitter / X */}
                        <a 
                            href="https://twitter.com" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:opacity-70 transition-opacity" 
                            aria-label="Twitter (X) Profile"
                        >
                            <Image 
                            src="/socials/Twitter-X--Streamline-Bootstrap.svg" 
                            alt="Twitter" 
                            width={20} 
                            height={20} 
                            className="h-5 w-5 object-contain" 
                            />
                        </a>

                        {/* Instagram */}
                        <a 
                            href="https://instagram.com" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:opacity-70 transition-opacity" 
                            aria-label="Instagram Profile"
                        >
                            <Image 
                            src="/socials/Instagram--Streamline-Core.svg" 
                            alt="Instagram" 
                            width={20} 
                            height={20} 
                            className="h-5 w-5 object-contain" 
                            />
                        </a>

                        {/* LinkedIn */}
                        <a 
                            href="https://linkedin.com" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:opacity-70 transition-opacity" 
                            aria-label="LinkedIn Profile"
                        >
                            <Image 
                            src="/socials/Linkedin--Streamline-Core.svg" 
                            alt="LinkedIn" 
                            width={20} 
                            height={20} 
                            className="h-5 w-5 object-contain" 
                            />
                        </a>

                        {/* TikTok */}
                        <a 
                            href="https://tiktok.com" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:opacity-70 transition-opacity" 
                            aria-label="TikTok Profile"
                        >
                            <Image 
                            src="/socials/Tiktok--Streamline-Core.svg" 
                            alt="TikTok" 
                            width={20} 
                            height={20} 
                            className="h-5 w-5 object-contain" 
                            />
                        </a>
                        </div>

                    <p className="mt-12 text-sm text-slate-500">
                        &copy; 2025 Lifestyle Spaces Inc. All rights reserved.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-x-16 gap-y-10 md:gap-x-24">
          
                    {/* Navigation Column 1 */}
                    <div className="flex flex-col gap-4">
                        <ul className="flex flex-col gap-3">
                            {columnOneLinks.map((link, idx) => (
                            <li key={idx}>
                                <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                        </ul>
                    </div>

                    <div className="flex flex-col gap-4">
                        <ul className="flex flex-col gap-3">
                        {columnTwoLinks.map((link, idx) => (
                            <li key={idx}>
                                <Link href={link.href} className="text-sm text-slate-600 hover:text-slate-900 transition-colors">
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                        </ul>
                    </div>
                </div>
            </div>
        </footer>
    )
}

