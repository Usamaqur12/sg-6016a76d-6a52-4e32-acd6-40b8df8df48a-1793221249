import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function HelpPage() {
  return (
    <InfoPageLayout title="Help Center" intro="Quick answers for the current PrimeBet demonstration.">
      <InfoSection title="Is this real money?">
        <p>No. Balances are demonstration credits and have no cash value.</p>
      </InfoSection>
      <InfoSection title="Why can’t I deposit or withdraw?">
        <p>Payments remain disabled until licensing, KYC, payment-provider approval, verified webhooks and reconciliation controls are complete.</p>
      </InfoSection>
      <InfoSection title="Why was a bet rejected?">
        <p>A selection may have changed price, become suspended, started already, exceeded a limit, or may only be preview data.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
