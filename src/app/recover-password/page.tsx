'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/auth/auth-provider";

export default function RecoverPasswordPage() {
  const { sendPasswordReset, configured } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await sendPasswordReset(email);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
  };

  return (
    <main className="relative isolate w-full min-h-screen flex items-center justify-center px-4 py-16 overflow-hidden">
      <div className="fixed inset-0 w-screen h-screen -z-10">
        <Image src="/600x400_Placeholder_Image.png" alt="Background" fill priority className="object-cover" />
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      </div>

      <Card className="w-full max-w-md rounded-3xl shadow-2xl border-slate-100 bg-white p-2 max-h-[85vh] overflow-y-auto">
        {sent ? (
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700">
              <MailCheck className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Check your email</h1>
            <p className="max-w-sm text-sm text-slate-600">
              If an account exists for <span className="font-semibold">{email}</span>,
              we&apos;ve sent instructions to reset your password.
            </p>
            <Link href="/login" className="text-slate-900 font-semibold underline">
              Back to log in
            </Link>
          </CardContent>
        ) : (
          <>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 text-center">
                Forgot your password?
              </CardTitle>
              <CardDescription className="text-slate-500 text-sm">
                Enter the email you used to sign up and we&apos;ll send you instructions to set a new password.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit} noValidate>
              <CardContent className="space-y-4">
                {!configured && (
                  <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Password recovery is not configured in this environment yet.
                  </p>
                )}
                {error && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="recover-email">Email</Label>
                  <Input
                    id="recover-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    className="h-11 rounded-xl"
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button
                  type="submit"
                  disabled={submitting || !configured}
                  className="w-full h-11 bg-slate-900 hover:bg-slate-800 rounded-xl font-bold text-sm shadow-lg"
                >
                  {submitting ? 'Sending…' : 'Send Instructions'}
                </Button>
                <p className="text-sm text-center text-slate-500">
                  Suddenly remembered your password? <Link href="/login" className="text-slate-900 font-semibold underline">Log in</Link>
                </p>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
