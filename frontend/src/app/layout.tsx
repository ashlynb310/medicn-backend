import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";
import Footer from "@/components/footer";
import { AuthProvider } from "@/components/auth/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The MediCN",
  description:
    "Housing marketplace for medical professionals on rotations, assignments, and relocations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased text-slate-900 bg-white`}>
        <AuthProvider>
          {/* Header and Footer render their own landmark elements, so wrap in
              plain divs to avoid nested <header>/<footer> landmarks. */}
          <div className="relative z-50">
            <Header />
          </div>

          <main className="grow">
            {children}
          </main>

          <div className="relative z-50">
            <Footer />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
