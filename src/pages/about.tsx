import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function AboutPage() {
  return (
    <InfoPageLayout title="About MindBet Pro" intro="MindBet Pro is a sportsbook and casino platform focused on secure account and wallet operations.">
      <InfoSection title="Platform status">
        <p>Available sports, payment methods and casino products depend on the providers enabled by the operator and the rules of each supported jurisdiction.</p>
      </InfoSection>
      <InfoSection title="Our approach">
        <p>We build around secure ledger accounting, responsible-play controls, transparent bet records, identity verification and role-based operations.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
