import { Toaster } from "@/components/ui/toaster";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { I18nProvider } from "@/lib/i18n";
import { MaintenanceGate } from "@/components/MaintenanceGate";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <I18nProvider>
      <AppErrorBoundary><MaintenanceGate><Component {...pageProps} /></MaintenanceGate></AppErrorBoundary>
      <Toaster />
      <PwaRegistration />
      <PwaInstallBanner />
    </I18nProvider>
  );
}
