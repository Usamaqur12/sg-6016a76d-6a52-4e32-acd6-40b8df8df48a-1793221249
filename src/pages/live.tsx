import { Radio } from "lucide-react";
import { SportsbookCataloguePage } from "@/components/sportsbook/SportsbookCataloguePage";

export default function LivePage() {
  return (
    <SportsbookCataloguePage
      title="Live Betting"
      description="In-play events with database-verified prices"
      icon={<Radio className="h-5 w-5 text-danger" />}
      liveOnly
    />
  );
}
