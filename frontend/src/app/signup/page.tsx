'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";

type UserType = 'renter' | 'host' | null;

// Values must match the backend HealthcareRole enum (underscored). The backend
// reads `healthcare_role` from Supabase user_metadata at sync time.
const healthcareRoleItems: Record<string, string> = {
  medical_student: 'Medical Student',
  nursing_student: 'Nursing Student',
  nurse: 'Nurse',
  resident_physician: 'Resident Physician',
  physician: 'Physician',
  other: 'Other',
};

export default function SignUpPage() {
  const router = useRouter();
  const { signUp, configured, status } = useAuth();

  const [userType, setUserType] = useState<UserType>(null);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [healthcareRole, setHealthcareRole] = useState<string>('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userType) {
      setError('Choose whether you are joining as a renter or a host.');
      return;
    }
    setError(null);
    setSubmitting(true);

    const result = await signUp({
      email,
      password,
      firstName,
      lastName,
      displayName,
      userType,
      healthcareRole:
        userType === 'renter' && healthcareRole ? healthcareRole : undefined,
    });

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    if (result.needsEmailConfirmation) {
      // Honest state: account created, but the session isn't active until the
      // email is confirmed. Do not pretend the user is logged in.
      setConfirmationSent(true);
      setSubmitting(false);
      return;
    }

    router.replace('/');
  };

  if (confirmationSent) {
    return (
      <main className="relative isolate w-full min-h-screen flex items-center justify-center px-4 py-16">
        <div className="fixed inset-0 w-screen h-screen -z-10">
          <Image src="/600x400_Placeholder_Image.png" alt="Background" fill priority className="object-cover" />
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
        </div>
        <Card className="w-full max-w-md rounded-3xl shadow-2xl border-slate-100 bg-white p-2">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-green-100 text-green-700">
              <MailCheck className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-bold text-slate-900">Confirm your email</h1>
            <p className="max-w-sm text-sm text-slate-600">
              We sent a confirmation link to <span className="font-semibold">{email}</span>.
              Click it to activate your account, then log in.
            </p>
            <Link href="/login" className="text-slate-900 font-semibold underline">
              Go to log in
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative isolate w-full min-h-screen flex items-center justify-center px-4 pt-16 pb-16">
      <div className="fixed inset-0 w-screen h-screen -z-10">
        <Image src="/600x400_Placeholder_Image.png" alt="Background" fill priority className="object-cover" />
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      </div>

      <Card className="w-full max-w-md rounded-3xl shadow-2xl border-slate-100 bg-white p-2">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight text-center text-slate-900">Create an account</CardTitle>
          <CardDescription className="text-slate-500 text-sm">
            Select your account type to fill out your registration.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            {!configured && (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Sign up is not configured in this environment yet. Add the Supabase
                environment variables to enable it.
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <RadioGroup onValueChange={(val) => setUserType(val as UserType)} className="grid grid-cols-2 gap-3">
              <div>
                <RadioGroupItem value="renter" id="renter" className="peer sr-only" />
                <Label
                  htmlFor="renter"
                  className={`flex flex-col h-full items-center text-center justify-center rounded-xl border-2 p-3 cursor-pointer transition-all
                    ${userType === 'renter'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-100 bg-popover text-slate-900 hover:bg-slate-50'
                    }`}
                >
                  <span className="font-bold text-sm">Renter</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="host" id="host" className="peer sr-only" />
                <Label
                  htmlFor="host"
                  className={`flex flex-col h-full items-center text-center justify-center rounded-xl border-2 p-3 cursor-pointer transition-all
                    ${userType === 'host'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-100 bg-popover text-slate-900 hover:bg-slate-50'
                    }`}
                >
                  <span className="font-bold text-sm">Host</span>
                </Label>
              </div>
            </RadioGroup>

            {userType !== null && (
              <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane.doe@example.com" className="h-11 rounded-xl" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-first">First Name</Label>
                  <Input id="signup-first" type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" className="h-11 rounded-xl" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-last">Last Name</Label>
                  <Input id="signup-last" type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" className="h-11 rounded-xl" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-display">Display Name</Label>
                  <Input id="signup-display" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane D" className="h-11 rounded-xl" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password (min 6 characters)" className="h-11 rounded-xl" minLength={6} required />
                </div>

                {userType === 'renter' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-role">Medical profession</Label>
                    <Select items={healthcareRoleItems} value={healthcareRole} onValueChange={(v) => setHealthcareRole(v ?? '')}>
                      <SelectTrigger id="signup-role" className="h-11 w-full rounded-xl">
                        <SelectValue placeholder="Select your medical profession" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(healthcareRoleItems).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </CardContent>
          {userType !== null && (
            <CardFooter className="flex flex-col gap-4">
              <div className="flex items-start space-x-2 w-full pb-2">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(checked) => setAcceptedTerms(!!checked)}
                  className="mt-0.5 border-slate-300 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white"
                />
                <label htmlFor="terms" className="text-xs font-medium text-slate-600 cursor-pointer select-none leading-relaxed">
                  I accept the{" "}
                  <Link href="/terms-of-service" className="text-slate-900 font-semibold underline hover:text-slate-700">Terms of Service</Link>
                  {" "}and{" "}
                  <Link href="/privacy-policy" className="text-slate-900 font-semibold underline hover:text-slate-700">Privacy Policy</Link>.
                </label>
              </div>
              <Button
                type="submit"
                disabled={submitting || !acceptedTerms || !configured}
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 rounded-xl font-bold text-sm shadow-lg"
              >
                {submitting ? 'Creating account…' : 'Complete Sign Up'}
              </Button>
              <p className="text-xs text-center text-slate-500">
                Already have an account? <Link href="/login" className="text-slate-900 font-semibold underline">Log in</Link>
              </p>
            </CardFooter>
          )}
        </form>
      </Card>
    </main>
  );
}
