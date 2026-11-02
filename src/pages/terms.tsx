import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function TermsPage() {
  return (
    <InfoPageLayout title="Terms & Conditions" intro="These terms govern access to MindBet Pro and its account, sportsbook, casino and promotional features.">
      <InfoSection title="No gambling contract">
        <p>Demo credits are not money, cannot be purchased or withdrawn, and do not create a claim to prizes or payouts.</p>
      </InfoSection>
      <InfoSection title="Eligibility">
        <p>The service is intended for adults aged 18 or over and is subject to identity, age, jurisdiction and account-status checks. Access may be suspended for security, misuse or maintenance.</p>
      </InfoSection>
      <InfoSection title="Data and availability">
        <p>Events, odds and results depend on configured data providers and applicable settlement rules. Features may be changed for security, compliance or service reliability.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
