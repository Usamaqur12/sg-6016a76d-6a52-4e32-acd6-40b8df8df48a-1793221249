import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Shield, Smartphone, CheckCircle, AlertCircle, Info } from "lucide-react";

type MfaFactor = { id: string; status: "verified" | "unverified"; friendly_name?: string };
type Enrollment = { factorId: string; qrCode: string; secret: string };

export function SecuritySettings() {
  const { toast } = useToast();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionExpiry, setSessionExpiry] = useState<number | null>(null);
  const [assuranceLevel, setAssuranceLevel] = useState<string>("aal1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSecurity = useCallback(async () => {
    const [factorResult, sessionResult, assuranceResult] = await Promise.all([
      supabase.auth.mfa.listFactors(), 
      supabase.auth.getSession(), 
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (factorResult.error) setError(factorResult.error.message);
    else setFactors((factorResult.data.totp ?? []) as MfaFactor[]);
    setSessionExpiry(sessionResult.data.session?.expires_at ?? null);
    if (!assuranceResult.error) setAssuranceLevel(assuranceResult.data.currentLevel ?? "aal1");
  }, []);

  useEffect(() => { void refreshSecurity(); }, [refreshSecurity]);
  const verifiedFactor = factors.find((factor) => factor.status === "verified");

  async function beginEnrollment() {
    setBusy(true); 
    setError(null);
    for (const factor of factors.filter((item) => item.status === "unverified")) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ 
      factorType: "totp", 
      friendlyName: "PrimeBet authenticator" 
    });
    if (enrollError) setError(enrollError.message);
    else setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    setBusy(false);
  }

  async function verifyEnrollment() {
    if (!enrollment || verificationCode.trim().length !== 6) return;
    setBusy(true); 
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.factorId });
    if (challenge.error) { 
      setError(challenge.error.message); 
      setBusy(false); 
      return; 
    }
    const verification = await supabase.auth.mfa.verify({ 
      factorId: enrollment.factorId, 
      challengeId: challenge.data.id, 
      code: verificationCode.trim() 
    });
    if (verification.error) setError(verification.error.message);
    else {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("profiles").update({ two_factor_enabled: true }).eq("id", userData.user.id);
      }
      setEnrollment(null); 
      setVerificationCode(""); 
      await refreshSecurity(); 
      toast({ title: "Two-factor authentication enabled", description: "Your admin account is now secured with 2FA." });
    }
    setBusy(false);
  }

  async function disableMfa() {
    if (!verifiedFactor) return;
    setBusy(true); 
    setError(null);
    const result = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id });
    if (result.error) setError(result.error.message);
    else {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("profiles").update({ two_factor_enabled: false }).eq("id", userData.user.id);
      }
      await refreshSecurity(); 
      toast({ title: "Two-factor authentication disabled", variant: "destructive" });
    }
    setBusy(false);
  }

  async function revokeOtherSessions() {
    setBusy(true); 
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) setError(signOutError.message); 
    else toast({ title: "Other sessions signed out", description: "All other devices have been logged out." });
    setBusy(false);
  }

  async function changePassword() {
    setError(null);
    if (password.length < 12) { 
      setError("Use at least 12 characters for the new password."); 
      return; 
    }
    if (password !== confirmPassword) { 
      setError("Passwords do not match."); 
      return; 
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else { 
      await supabase.auth.signOut({ scope: "others" }); 
      setPassword(""); 
      setConfirmPassword(""); 
      toast({ 
        title: "Password updated", 
        description: "Other sessions were signed out for security." 
      }); 
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Two-Factor Authentication Section - HIDDEN per user request */}
      <div className="space-y-4 hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-5 w-5 text-primary" />
              <div className="font-semibold text-lg">Two-Factor Authentication</div>
            </div>
            <p className="text-sm text-muted-foreground">
              Add an extra layer of security by requiring a 6-digit code from your authenticator app when signing in.
            </p>
            {verifiedFactor && (
              <div className="mt-2 flex items-center gap-2 text-sm text-success">
                <CheckCircle className="h-4 w-4" />
                <span>Enabled and active</span>
              </div>
            )}
          </div>
          <Switch 
            checked={Boolean(verifiedFactor)} 
            disabled={busy || Boolean(enrollment)} 
            onCheckedChange={(enabled) => void (enabled ? beginEnrollment() : disableMfa())} 
          />
        </div>

        {/* Setup Guide - Shown when enrolling */}
        {enrollment && (
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 flex-shrink-0">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-base mb-1">Set up authenticator app</h3>
                <p className="text-sm text-muted-foreground">
                  Follow these steps to secure your account with two-factor authentication.
                </p>
              </div>
            </div>

            {/* Step-by-step guide */}
            <div className="space-y-4 pl-11">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">
                    1
                  </div>
                  <span className="font-medium text-sm">Download an authenticator app</span>
                </div>
                <p className="text-sm text-muted-foreground pl-8">
                  If you don't have one already, download Google Authenticator, Microsoft Authenticator, or Authy on your phone.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">
                    2
                  </div>
                  <span className="font-medium text-sm">Scan this QR code</span>
                </div>
                <div className="pl-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Open your authenticator app and scan this QR code to add PrimeBet to your app.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="rounded-lg border-2 border-border bg-white p-3">
                      <Image 
                        src={enrollment.qrCode} 
                        alt="Authenticator QR code" 
                        width={180} 
                        height={180} 
                        unoptimized 
                        className="h-45 w-45"
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="rounded-lg border border-border bg-muted/50 p-3">
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                          Can't scan? Enter this code manually:
                        </div>
                        <code className="text-xs font-mono break-all text-foreground">
                          {enrollment.secret}
                        </code>
                      </div>
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>Keep this code secure. You'll need it if you switch devices.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">
                    3
                  </div>
                  <span className="font-medium text-sm">Enter the 6-digit code</span>
                </div>
                <div className="pl-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Your authenticator app will show a 6-digit code. Enter it below to complete setup.
                  </p>
                  <div className="max-w-xs space-y-2">
                    <Label htmlFor="verification-code">Verification code</Label>
                    <Input 
                      id="verification-code"
                      inputMode="numeric" 
                      pattern="[0-9]*" 
                      maxLength={6} 
                      placeholder="123456" 
                      value={verificationCode} 
                      onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
                      className="text-center text-lg tracking-widest font-mono h-12"
                      autoFocus
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button 
                onClick={() => void verifyEnrollment()} 
                disabled={busy || verificationCode.length !== 6}
                className="bg-primary hover:bg-primary/90"
              >
                {busy ? "Verifying..." : "Verify and enable 2FA"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => { setEnrollment(null); setVerificationCode(""); }}
                disabled={busy}
              >
                Cancel setup
              </Button>
            </div>
          </div>
        )}

        {/* Info when 2FA is not enabled */}
        {!verifiedFactor && !enrollment && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Admin access requires 2FA.</strong> Enable two-factor authentication above to access the admin portal.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Current Session Section */}
      <div className="space-y-3 border-t border-border pt-6">
        <div>
          <div className="font-semibold mb-1">Current session</div>
          <div className="text-sm text-muted-foreground">
            Security level: <span className="font-medium">{assuranceLevel.toUpperCase()}</span>
            {sessionExpiry && (
              <>
                {" · "}Expires: {new Date(sessionExpiry * 1000).toLocaleString()}
              </>
            )}
          </div>
        </div>
        <Button 
          variant="outline" 
          onClick={() => void revokeOtherSessions()} 
          disabled={busy}
        >
          Sign out all other devices
        </Button>
      </div>

      {/* Change Password Section */}
      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <div className="font-semibold mb-1">Change password</div>
          <p className="text-sm text-muted-foreground">
            Use at least 12 characters. All other sessions will be signed out for security.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input 
              id="new-password"
              type="password" 
              placeholder="Min. 12 characters" 
              autoComplete="new-password" 
              value={password} 
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input 
              id="confirm-password"
              type="password" 
              placeholder="Re-enter password" 
              autoComplete="new-password" 
              value={confirmPassword} 
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={12}
            />
          </div>
        </div>
        <Button 
          onClick={() => void changePassword()} 
          disabled={busy || !password || password.length < 12}
        >
          Update password
        </Button>
      </div>
    </div>
  );
}