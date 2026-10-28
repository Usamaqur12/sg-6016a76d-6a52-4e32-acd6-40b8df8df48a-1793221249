import { useEffect, useState } from "react";
import { Download, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    setDismissed(sessionStorage.getItem("primebet-install-dismissed") === "1");

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    const installed = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  function dismiss() {
    sessionStorage.setItem("primebet-install-dismissed", "1");
    setDismissed(true);
  }

  if (!online) {
    return (
      <div className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-warning/40 bg-background/95 px-4 py-3 shadow-2xl backdrop-blur">
        <WifiOff className="h-5 w-5 flex-shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-sm font-bold">You are offline</p>
          <p className="text-xs text-muted-foreground">Wallet, odds and bet placement will resume when your connection returns.</p>
        </div>
      </div>
    );
  }

  if (!installPrompt || dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-[80] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-primary/30 bg-background/95 p-3 shadow-2xl backdrop-blur lg:bottom-5">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Install PrimeBet</p>
        <p className="text-xs text-muted-foreground">Faster full-screen access from your home screen.</p>
      </div>
      <Button size="sm" onClick={() => void install()}>Install</Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Dismiss install prompt" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
