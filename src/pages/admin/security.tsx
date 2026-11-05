import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { CheckCircle, Copy, KeyRound, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TotpFactor = {
  id: string;
  friendly_name?: string;
  status: string;
};

type Enrollment = {
  id: string;
  qrCode: string;
  secret: string;
};

export default function AdminSecurityPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [currentLevel, setCurrentLevel] = useState<string>("aal1");
  const [nextLevel, setNextLevel] = useState<string>("aal1");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      await router.replace("/admin/login");
      return;
    }

    const [{ data: factorData, error: factorError }, { data: assuranceData, error: assuranceError }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    if (factorError || assuranceError) {
      toast({
        title: "Security status unavailable",
        description: factorError?.message || assuranceError?.message || "Please refresh and try again.",
        variant: "destructive",
      });
    }

    setFactors(((factorData?.totp || []) as TotpFactor[]).filter((factor) => factor.status === "verified"));
    setCurrentLevel(assuranceData?.currentLevel || "aal1");
    setNextLevel(assuranceData?.nextLevel || "aal1");
    setLoading(false);
  }, [router, toast]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  async function startEnrollment() {
    setWorking(true);
    setCode("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "MindBet Pro Admin",
    });
    setWorking(false);

    if (error || !data) {
      toast({ title: "Could not start 2FA", description: error?.message || "Enrollment failed", variant: "destructive" });
      return;
    }

    setEnrollment({
      id: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verifyFactor(factorId: string) {
    if (!/^\d{6}$/.test(code.trim())) {
      toast({ title: "Enter the 6-digit code", variant: "destructive" });
      return;
    }

    setWorking(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setWorking(false);
      toast({ title: "2FA challenge failed", description: challengeError?.message, variant: "destructive" });
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setWorking(false);

    if (verifyError) {
      toast({ title: "Invalid security code", description: verifyError.message, variant: "destructive" });
      return;
    }

    setEnrollment(null);
    setCode("");
    toast({ title: "Admin security verified", description: "Sensitive admin operations are unlocked for this session." });
    await loadSecurity();
  }

  async function copySecret() {
    if (!enrollment?.secret) return;
    await navigator.clipboard.writeText(enrollment.secret);
    toast({ title: "Setup key copied" });
  }

  const verifiedFactor = factors[0];
  const elevated = currentLevel === "aal2";

  return (
    <AdminLayout>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold"><KeyRound className="h-7 w-7 text-primary" />Admin Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">Verify sensitive finance, KYC, payout and trading actions.</p>
        </div>

        <Card className={elevated ? "border-success/40" : "border-warning/40"}>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg">{elevated ? <CheckCircle className="h-5 w-5 text-success" /> : <ShieldAlert className="h-5 w-5 text-warning" />}Current session</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking security status…</div>
            ) : (
              <>
                <p className="text-sm">{elevated ? "Verified (AAL2). Sensitive admin controls are available." : "Standard login (AAL1). Sensitive controls stay locked until you enter an authenticator code."}</p>
                <p className="text-xs text-muted-foreground">Current: {currentLevel} · Next available: {nextLevel} · Verified authenticators: {factors.length}</p>
                <Button variant="outline" size="sm" onClick={() => void loadSecurity()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
              </>
            )}
          </CardContent>
        </Card>

        {!verifiedFactor && !enrollment && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Set up an authenticator</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Use Google Authenticator, Microsoft Authenticator, Authy or another TOTP app.</p>
              <Button onClick={() => void startEnrollment()} disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start setup</Button>
            </CardContent>
          </Card>
        )}

        {enrollment && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Scan and verify</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="w-fit rounded-xl bg-white p-3"><img src={enrollment.qrCode} alt="Authenticator QR code" className="h-52 w-52" /></div>
              <div>
                <Label>Manual setup key</Label>
                <div className="mt-1 flex gap-2"><Input value={enrollment.secret} readOnly className="font-mono" /><Button variant="outline" size="icon" onClick={() => void copySecret()}><Copy className="h-4 w-4" /></Button></div>
              </div>
              <div>
                <Label htmlFor="enrollment-code">6-digit code</Label>
                <Input id="enrollment-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="mt-1 max-w-xs font-mono text-lg tracking-[0.35em]" />
              </div>
              <Button onClick={() => void verifyFactor(enrollment.id)} disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify and enable</Button>
            </CardContent>
          </Card>
        )}

        {verifiedFactor && !elevated && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Unlock sensitive controls</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter the current code from your authenticator app. This elevates the current admin session to AAL2.</p>
              <div>
                <Label htmlFor="challenge-code">6-digit code</Label>
                <Input id="challenge-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="mt-1 max-w-xs font-mono text-lg tracking-[0.35em]" />
              </div>
              <Button onClick={() => void verifyFactor(verifiedFactor.id)} disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify session</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
