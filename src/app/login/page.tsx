'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, configured, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in (e.g. navigated here directly), leave the auth pages.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }
    // Redirect to the requested page (set by SignInRequired), else home.
    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    router.replace(returnTo && returnTo.startsWith('/') ? returnTo : '/');
  };

  return (
    <main className="relative w-full min-h-screen flex items-center justify-center px-4 py-16 overflow-hidden">
      <div className="fixed inset-0 w-screen h-screen -z-10">
        <Image src="/600x400_Placeholder_Image.png" alt="Background" fill priority className="object-cover" />
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      </div>

      <Card className="w-full max-w-md rounded-3xl shadow-2xl border-slate-100 bg-white p-2">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center font-bold tracking-tight text-slate-900">Welcome back</CardTitle>
          <CardDescription className="text-slate-500 text-sm">
            Enter your credentials to access your account.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            {!configured && (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Sign in is not configured in this environment yet. Add the Supabase
                environment variables to enable it.
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="text-slate-900">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane.doe@example.com"
                className="h-11 rounded-xl"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-slate-900">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password..."
                className="h-11 rounded-xl"
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <p className="text-sm text-center text-slate-500">
              Forgot your password? <Link href="/recover-password" className="text-slate-900 font-semibold underline">Reset Password</Link>
            </p>
            <Button
              type="submit"
              disabled={submitting || !configured}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 rounded-xl font-bold text-sm shadow-lg"
            >
              {submitting ? 'Signing in…' : 'Log In'}
            </Button>
            <p className="text-sm text-center text-slate-500">
              Do not have an account? <Link href="/signup" className="text-slate-900 font-semibold underline">Sign up</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
