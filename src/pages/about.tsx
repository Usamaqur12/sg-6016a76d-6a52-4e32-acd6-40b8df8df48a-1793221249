import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function AboutPage() {
  return (
    <InfoPageLayout title="About PrimeBet" intro="PrimeBet is currently a play-money sportsbook demonstration under active development.">
      <InfoSection title="Current status">
        <p>No real-money deposits, withdrawals or cash prizes are available. Displayed events and prices may be demonstration data until a production sports feed is connected.</p>
      </InfoSection>
      <InfoSection title="Our approach">
        <p>We are building the product around secure wallet accounting, responsible-play controls, transparent bet records and role-based operations.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
