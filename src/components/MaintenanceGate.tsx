import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import { Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ enabled: boolean; message: string }>({ enabled: false, message: "" });
  const check = useCallback(async () => {
    if (router.pathname.startsWith("/admin")) { setState({ enabled: false, message: "" }); return; }
    const { data } = await (supabase as any).from("feature_flags").select("is_enabled,config").eq("key", "maintenance_mode").maybeSingle();
    setState({ enabled: Boolean(data?.is_enabled), message: String(data?.config?.message || "PrimeBet is receiving an upgrade. Please check back shortly.") });
  }, [router.pathname]);
  useEffect(() => { void check(); const timer = window.setInterval(() => void check(), 30_000); return () => window.clearInterval(timer); }, [check]);
  if (!state.enabled) return <>{children}</>;
  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-lg rounded-2xl border border-warning/30 bg-surface p-8 text-center shadow-2xl"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10"><Wrench className="h-8 w-8 text-warning" /></div><h1 className="text-3xl font-black">Scheduled maintenance</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{state.message}</p><Button className="mt-6" variant="outline" onClick={() => void check()}>Check again</Button><p className="mt-4 text-xs text-muted-foreground">Administrators can still sign in at /admin/login.</p></div></main>;
}

