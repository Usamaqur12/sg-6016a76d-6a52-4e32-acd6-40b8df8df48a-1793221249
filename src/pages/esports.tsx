import { Gamepad2 } from "lucide-react";
import { SportsbookCataloguePage } from "@/components/sportsbook/SportsbookCataloguePage";

export default function EsportsPage() {
  return (
    <SportsbookCataloguePage
      title="Esports"
      description="Verified esports fixtures and prices"
      icon={<Gamepad2 className="h-5 w-5 text-primary" />}
      sportSlug="esports"
    />
  );
}
