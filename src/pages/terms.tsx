import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function TermsPage() {
  return (
    <InfoPageLayout title="Terms & Conditions" intro="These terms govern access to MindBet Pro and its account, sportsbook, casino and promotional features.">
      <InfoSection title="Account funding">
        <p>Account balances are created only through approved deposits, promotions or audited administrative adjustments. Incorrect or unauthorized credits may be corrected.</p>
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
