import type { ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Card, CardContent } from "@/components/ui/card";
import { siteConfig } from "@/config/site";
import { useRouter } from "next/router";

interface InfoPageLayoutProps {
  title: string;
  intro: string;
  children: ReactNode;
}

export function InfoPageLayout({ title, intro, children }: InfoPageLayoutProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={null} onAuthClick={() => router.push("/auth/login")} />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="prose prose-slate dark:prose-invert max-w-none">
          {children}
        </div>
      </main>
      <Footer />
      <MobileBottomNav />
    </div>
  );
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold mb-2">{title}</h2>
      <div className="text-muted-foreground space-y-2">{children}</div>
    </section>
  );
}
