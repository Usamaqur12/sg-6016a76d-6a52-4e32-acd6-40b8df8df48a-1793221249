import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else { await supabase.auth.signOut({ scope: "others" }); await router.push("/account/settings"); }
    setLoading(false);
  }

  return <div className="min-h-screen flex items-center justify-center bg-background p-4"><Card className="w-full max-w-md surface"><CardHeader><CardTitle>Choose a new password</CardTitle><CardDescription>The recovery link must still be valid.</CardDescription></CardHeader><CardContent>{!ready ? <Alert variant="destructive"><AlertDescription>Open this page from the password-reset email.</AlertDescription></Alert> : <form className="space-y-4" onSubmit={submit}>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required autoComplete="new-password" /></div><div className="space-y-2"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={12} required autoComplete="new-password" /></div><Button className="w-full" disabled={loading}>{loading ? "Updating..." : "Update password"}</Button></form>}</CardContent></Card></div>;
}
