import { InfoPageLayout, InfoSection } from "@/components/content/InfoPageLayout";

export default function PrivacyPage() {
  return (
    <InfoPageLayout title="Privacy Notice" intro="This interim notice explains the main data used by the pre-launch demo.">
      <InfoSection title="Data we process">
        <p>We may process account identifiers, profile details, authentication events, demo bets, device/security logs and support messages needed to operate and secure the service.</p>
      </InfoSection>
      <InfoSection title="Sensitive documents">
        <p>Do not upload identity or payment documents until an approved KYC provider and final privacy notice are active.</p>
      </InfoSection>
      <InfoSection title="Your choices">
        <p>You may request account assistance through the contact page. Retention periods, processors and jurisdiction-specific rights will be published before production launch.</p>
      </InfoSection>
    </InfoPageLayout>
  );
}
