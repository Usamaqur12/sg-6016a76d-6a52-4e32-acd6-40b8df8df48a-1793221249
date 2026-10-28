import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { uploadKYCDocument, getUserKYCDocuments } from "@/services/kycService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { 
  ArrowLeft, Shield, Upload, FileText, CheckCircle,
  XCircle, Clock
} from "lucide-react";
import Link from "next/link";
import { defaultNotificationPreferences, getNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from "@/services/notificationsService";
import { useToast } from "@/hooks/use-toast";
import { SecuritySettings } from "@/components/account/SecuritySettings";

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
  const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function Settings() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [kycDocuments, setKycDocuments] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [displayPreferences, setDisplayPreferences] = useState({ locale: "en", currency: "USD", timezone: "Asia/Karachi", oddsFormat: "decimal" });
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    setUser(user);

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profile) {
      setProfile(profile);
      const profilePreferences = profile as typeof profile & { locale?: string; display_currency?: string; timezone?: string; odds_format?: string };
      setDisplayPreferences({ locale: profilePreferences.locale || "en", currency: profilePreferences.display_currency || "USD", timezone: profilePreferences.timezone || "Asia/Karachi", oddsFormat: profilePreferences.odds_format || "decimal" });
      const profileLocale = profilePreferences.locale === "ur" ? "ur" : "en";
      window.localStorage.setItem("primebet-locale", profileLocale);
      window.dispatchEvent(new CustomEvent("primebet:locale", { detail: profileLocale }));
      loadKYCDocuments(user.id);
    }
    const preferenceResult = await getNotificationPreferences();
    setNotificationPreferences(preferenceResult.preferences);
    const { data: pushFlag } = await (supabase as any).from("feature_flags").select("is_enabled").eq("name", "web_push").maybeSingle();
    setPushEnabled(Boolean(pushFlag?.is_enabled));
    setPushPermission("Notification" in window ? window.Notification.permission : "unsupported");
  }

  async function requestBrowserNotifications() {
    if (!("Notification" in window)) { toast({ title: "Browser notifications are not supported", variant: "destructive" }); return; }
    const permission = await window.Notification.requestPermission();
    setPushPermission(permission);
    if (permission === "granted") {
      const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
      if (publicKey && "serviceWorker" in navigator && "PushManager" in window) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const existing = await registration.pushManager.getSubscription();
          const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
          const serialized = subscription.toJSON();
          const { data: { session } } = await supabase.auth.getSession();
          const response = await fetch("/api/notifications/push/subscribe", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify({ endpoint: subscription.endpoint, keys: serialized.keys }) });
          if (!response.ok) throw new Error((await response.json()).error || "Push enrollment failed");
          toast({ title: "Browser alerts enabled", description: "This device is registered for secure push delivery." });
        } catch (error) { toast({ title: "Permission granted, enrollment pending", description: error instanceof Error ? error.message : "Push enrollment failed", variant: "destructive" }); }
      } else {
        new window.Notification("PrimeBet alerts ready", { body: "Permission is active. Server delivery will start after VAPID configuration." });
        toast({ title: "Browser permission enabled", description: "Add the production VAPID public key to activate remote delivery." });
      }
    } else toast({ title: "Browser alerts were not enabled", description: permission === "denied" ? "You can change this permission in your browser settings." : undefined });
  }

  async function saveDisplayPreferences() {
    setSavingPreferences(true);
    const { error } = await (supabase as any).rpc("update_my_display_preferences", { p_locale: displayPreferences.locale, p_currency: displayPreferences.currency, p_timezone: displayPreferences.timezone, p_odds_format: displayPreferences.oddsFormat });
    if (error) toast({ title: "Display preferences not saved", description: error.message, variant: "destructive" });
    else {
      const locale = displayPreferences.locale === "ur" ? "ur" : "en";
      window.localStorage.setItem("primebet-locale", locale);
      window.dispatchEvent(new CustomEvent("primebet:locale", { detail: locale }));
      toast({ title: "Display preferences saved" });
    }
    setSavingPreferences(false);
  }

  async function updateNotificationPreference(key: keyof NotificationPreferences, value: boolean) {
    const next = { ...notificationPreferences, [key]: value };
    setNotificationPreferences(next);
    setSavingPreferences(true);
    const result = await saveNotificationPreferences(next);
    if (!result.success) {
      setNotificationPreferences(notificationPreferences);
      toast({ title: "Preference not saved", description: result.error, variant: "destructive" });
    }
    setSavingPreferences(false);
  }

  async function loadKYCDocuments(userId: string) {
    setLoading(true);
    const { success, documents } = await getUserKYCDocuments(userId);

    if (success && documents) {
      setKycDocuments(documents);
    }

    setLoading(false);
  }

  async function handleKYCUpload(type: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);

    const { success, error } = await uploadKYCDocument(user.id, type, file);

    if (success) {
      alert("KYC document uploaded successfully!");
      loadKYCDocuments(user.id);
      
      // Refresh profile
      const { data: updatedProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (updatedProfile) {
        setProfile(updatedProfile);
      }
    } else {
      alert(`Upload failed: ${error}`);
    }

    setUploading(false);
  }

  const getKYCStatusIcon = () => {
    if (!profile) return null;
    
    switch (profile.kyc_status) {
      case "approved":
        return <CheckCircle className="h-5 w-5 text-success" />;
      case "pending":
        return <Clock className="h-5 w-5 text-warning" />;
      case "rejected":
        return <XCircle className="h-5 w-5 text-danger" />;
      default:
        return <Shield className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getKYCStatusBadge = () => {
    if (!profile) return null;
    
    switch (profile.kyc_status) {
      case "approved":
        return <Badge className="bg-success/10 text-success border-success/30">Verified</Badge>;
      case "pending":
        return <Badge variant="outline" className="badge-featured">Under Review</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Not Submitted</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={
          profile
            ? {
                email: user?.email || "",
                balance: profile.demo_balance || 0,
              }
            : null
        }
        onAuthClick={() => router.push("/auth/login")}
      />

      <main className="flex-1 container py-6">
        <div className="max-w-4xl mx-auto">
          {/* Back Button */}
          <Link href="/account">
            <Button variant="ghost" size="sm" className="mb-4 hover:bg-surface">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Account
            </Button>
          </Link>

          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-1">Account Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account preferences and verification
            </p>
          </div>

          <Card className="surface mb-6 border-primary/20">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div><div className="font-medium">Responsible Play Controls</div><div className="text-sm text-muted-foreground">Set stake limits, time-outs and self-exclusion.</div></div>
              <Link href="/account/responsible-play"><Button variant="outline" size="sm">Manage controls</Button></Link>
            </CardContent>
          </Card>

          {/* Tabs */}
          <Tabs defaultValue="profile">
            <TabsList className="bg-surface mb-6">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="kyc">KYC Verification</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
            </TabsList>

            {/* Profile Tab */}
            <TabsContent value="profile">
              <Card className="surface">
                <CardHeader>
                  <CardTitle className="text-lg">Profile Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Email</Label>
                    <Input 
                      value={user?.email || ""} 
                      disabled 
                      className="mt-2 bg-background"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Email cannot be changed
                    </p>
                  </div>

                  <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                    <label className="space-y-2"><Label>Language</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={displayPreferences.locale} onChange={(event) => setDisplayPreferences((current) => ({ ...current, locale: event.target.value }))}><option value="en">English</option><option value="ur">Urdu</option></select></label>
                    <label className="space-y-2"><Label>Display currency</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={displayPreferences.currency} onChange={(event) => setDisplayPreferences((current) => ({ ...current, currency: event.target.value }))}><option value="USD">USD</option><option value="PKR">PKR</option></select></label>
                    <label className="space-y-2"><Label>Timezone</Label><Input value={displayPreferences.timezone} onChange={(event) => setDisplayPreferences((current) => ({ ...current, timezone: event.target.value }))} placeholder="Asia/Karachi" /></label>
                    <label className="space-y-2"><Label>Odds format</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={displayPreferences.oddsFormat} onChange={(event) => setDisplayPreferences((current) => ({ ...current, oddsFormat: event.target.value }))}><option value="decimal">Decimal</option><option value="fractional">Fractional</option><option value="american">American</option></select></label>
                    <Button className="sm:col-span-2 sm:w-fit" onClick={() => void saveDisplayPreferences()} disabled={savingPreferences}>{savingPreferences ? "Saving…" : "Save display preferences"}</Button>
                  </div>

                  <div>
                    <Label>Account Type</Label>
                    <div className="mt-2">
                      <Badge variant="outline">Demo Account</Badge>
                    </div>
                  </div>

                  <div>
                    <Label>Member Since</Label>
                    <div className="text-sm mt-2">
                      {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "N/A"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* KYC Tab */}
            <TabsContent value="kyc">
              <Card className="surface mb-4">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    {getKYCStatusIcon()}
                    <div className="flex-1">
                      <div className="font-semibold mb-1">Verification Status</div>
                      <div className="text-sm text-muted-foreground">
                        {profile?.kyc_status === "approved" && "Your account is fully verified"}
                        {profile?.kyc_status === "pending" && "Your documents are under review"}
                        {profile?.kyc_status === "rejected" && "Verification failed. Please resubmit documents"}
                        {!profile?.kyc_status && "Please submit your documents for verification"}
                      </div>
                    </div>
                    {getKYCStatusBadge()}
                  </div>
                </CardContent>
              </Card>

              <Card className="surface">
                <CardHeader>
                  <CardTitle className="text-lg">Upload Documents</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Government ID</Label>
                    <div className="mt-2 flex items-center gap-2">
                      <Input id="kyc-national-id"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleKYCUpload("national_id", e)}
                        disabled={uploading}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" disabled={uploading} aria-label="Choose government ID" onClick={() => document.getElementById("kyc-national-id")?.click()}>
                        <Upload className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label>Selfie Verification</Label>
                    <div className="mt-2 flex items-center gap-2">
                      <Input id="kyc-selfie"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleKYCUpload("selfie", e)}
                        disabled={uploading}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" disabled={uploading} aria-label="Choose selfie document" onClick={() => document.getElementById("kyc-selfie")?.click()}>
                        <Upload className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label>Proof of Address</Label>
                    <div className="mt-2 flex items-center gap-2">
                      <Input id="kyc-address"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => handleKYCUpload("proof_of_address", e)}
                        disabled={uploading}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="icon" disabled={uploading} aria-label="Choose proof of address" onClick={() => document.getElementById("kyc-address")?.click()}>
                        <Upload className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {uploading && (
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                      Uploading...
                    </div>
                  )}

                  {kycDocuments.length > 0 && (
                    <div className="pt-4 border-t border-border">
                      <h4 className="font-semibold mb-3">Uploaded Documents</h4>
                      <div className="space-y-2">
                        {kycDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-3 rounded bg-background border border-border">
                            <div className="flex items-center gap-3">
                              <FileText className="h-4 w-4 text-primary" />
                              <div>
                                <div className="text-sm font-medium">{doc.document_type.replace("_", " ").toUpperCase()}</div>
                                <div className="text-xs text-muted-foreground">
                                  Uploaded {new Date(doc.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            {doc.status === "approved" && <CheckCircle className="h-4 w-4 text-success" />}
                            {doc.status === "pending" && <Clock className="h-4 w-4 text-warning" />}
                            {doc.status === "rejected" && <XCircle className="h-4 w-4 text-danger" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security">
              <Card className="surface">
                <CardHeader>
                  <CardTitle className="text-lg">Security Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SecuritySettings />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications">
              <Card className="surface">
                <CardHeader>
                  <CardTitle className="text-lg">Notification Preferences</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium">Browser push readiness</div><div className="text-sm text-muted-foreground">Permission: <span className="font-semibold capitalize">{pushPermission}</span>. External push delivery requires a configured provider and service worker.</div></div><Button variant="outline" disabled={!pushEnabled || pushPermission === "granted" || pushPermission === "unsupported"} onClick={() => void requestBrowserNotifications()}>{!pushEnabled ? "Disabled by admin" : pushPermission === "granted" ? "Enabled" : "Enable browser alerts"}</Button></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">Bet Results</div>
                      <div className="text-sm text-muted-foreground">
                        Get notified when your bets are settled
                      </div>
                    </div>
                    <Switch checked={notificationPreferences.bet_results} disabled={savingPreferences} onCheckedChange={(value) => void updateNotificationPreference("bet_results", value)} />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div>
                      <div className="font-medium">Promotions</div>
                      <div className="text-sm text-muted-foreground">
                        Receive updates about bonuses and offers
                      </div>
                    </div>
                    <Switch checked={notificationPreferences.promotions} disabled={savingPreferences} onCheckedChange={(value) => void updateNotificationPreference("promotions", value)} />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div>
                      <div className="font-medium">Account Updates</div>
                      <div className="text-sm text-muted-foreground">
                        Important account and security notifications
                      </div>
                    </div>
                    <Switch checked={notificationPreferences.account_updates} disabled={savingPreferences} onCheckedChange={(value) => void updateNotificationPreference("account_updates", value)} />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div>
                      <div className="font-medium">Live Events</div>
                      <div className="text-sm text-muted-foreground">
                        Notifications for your favorite events
                      </div>
                    </div>
                    <Switch checked={notificationPreferences.live_events} disabled={savingPreferences} onCheckedChange={(value) => void updateNotificationPreference("live_events", value)} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}
