import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function TermsPage() {
  return (
    <InfoPageLayout title="Demo Terms" intro="These interim terms apply only to the pre-launch play-money demonstration.">
      <InfoSection title="No gambling contract">
        <p>Demo credits are not money, cannot be purchased or withdrawn, and do not create a claim to prizes or payouts.</p>
      </InfoSection>
      <InfoSection title="Eligibility">
        <p>The demo is intended for adults aged 18 or over. Access may be suspended for testing, security, misuse or maintenance.</p>
      </InfoSection>
      <InfoSection title="Data and availability">
        <p>Events, odds and results may be simulated. Features can change before launch. Final jurisdiction-specific terms will replace these terms before real-money service begins.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
