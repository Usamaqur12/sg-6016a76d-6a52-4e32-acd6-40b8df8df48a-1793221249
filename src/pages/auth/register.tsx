import { useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, MailCheck, UserPlus } from "lucide-react";
import { authService } from "@/services/authService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandLogo } from "@/components/brand/BrandLogo";

export default function RegisterPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState("");

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = fullName.trim();

    if (normalizedName.length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (password.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!adultConfirmed || !termsAccepted) {
      setError("You must confirm your age and accept the terms.");
      return;
    }

    setLoading(true);
    const result = await authService.signUp(normalizedEmail, password, {
      full_name: normalizedName,
      signup_source: "public",
    });
    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (result.session) {
      await authService.signOut();
      setError(
        "Email confirmation is not enabled in Supabase. Enable Confirm email before accepting public registrations."
      );
      return;
    }

    setSubmittedEmail(normalizedEmail);
    setPassword("");
    setConfirmPassword("");
  }

  if (submittedEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border bg-surface text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Verify your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <strong>{submittedEmail}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Open the email and click the verification link before logging in. Check spam or junk if it is not visible.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href="/auth/login">Go to login</Link>
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSubmittedEmail("")}
            >
              Use a different email
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 py-10">
      <Card className="w-full max-w-md border-border bg-surface">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex justify-center"><BrandLogo href="/" /></div>
          <CardTitle className="text-2xl">Create your MindBet Pro account</CardTitle>
          <CardDescription>
            Verify your email to activate your account and access betting and wallet features.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="full-name">Full name</Label>
              <Input
                id="full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                minLength={2}
                maxLength={120}
                autoComplete="name"
                placeholder="Your full name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="register-email">Email</Label>
              <Input
                id="register-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={320}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="register-password">Password</Label>
              <div className="relative">
                <Input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Repeat your password"
                required
              />
            </div>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={adultConfirmed}
                onCheckedChange={(value) => setAdultConfirmed(value === true)}
                className="mt-0.5"
              />
              <span>I confirm that I meet the legal gambling age in my jurisdiction.</span>
            </label>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={termsAccepted}
                onCheckedChange={(value) => setTermsAccepted(value === true)}
                className="mt-0.5"
              />
              <span>
                I accept the <Link href="/terms" className="text-primary hover:underline">Terms</Link> and{" "}
                <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
              </span>
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              <UserPlus className="mr-2 h-4 w-4" />
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Already registered? <Link href="/auth/login" className="text-primary hover:underline">Log in</Link>
          </p>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Back to home</Link>
        </CardFooter>
      </Card>
    </div>
  );
}
