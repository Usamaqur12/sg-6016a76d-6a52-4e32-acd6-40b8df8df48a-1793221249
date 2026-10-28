import { useState } from "react";
import Link from "next/link";
import { authService } from "@/services/authService";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null);
    const result = await authService.resetPassword(email.trim());
    if (result.error) setError(result.error.message);
    else setMessage("If that account exists, a secure password-reset link has been sent.");
    setLoading(false);
  }

  return <div className="min-h-screen flex items-center justify-center bg-background p-4"><Card className="w-full max-w-md surface"><CardHeader><CardTitle>Reset password</CardTitle><CardDescription>We will email a one-time recovery link.</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}<div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></div><Button className="w-full" disabled={loading}>{loading ? "Sending..." : "Send reset link"}</Button></form></CardContent><CardFooter><Link href="/auth/login" className="text-sm text-primary hover:underline">Back to login</Link></CardFooter></Card></div>;
}
