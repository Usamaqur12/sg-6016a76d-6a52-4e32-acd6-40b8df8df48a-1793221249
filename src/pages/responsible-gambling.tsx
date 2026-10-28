import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function ResponsibleGamblingPage() {
  return (
    <InfoPageLayout title="Responsible Play" intro="Keep play controlled, intentional and within limits—even when using demo credits.">
      <InfoSection title="Practical safeguards">
        <p>Set time and stake limits, take regular breaks, never chase losses, and do not treat betting as income.</p>
      </InfoSection>
      <InfoSection title="Account controls">
        <p>Use <Link className="text-primary hover:underline" href="/account/responsible-play">responsible-play controls</Link> to set binding stake limits, take a time-out or activate self-exclusion.</p>
      </InfoSection>
      <InfoSection title="Need help?">
        <p>If betting is causing harm, stop and seek support from an independent gambling-harm service in your country. Local helpline details will be added for each licensed market before launch.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
