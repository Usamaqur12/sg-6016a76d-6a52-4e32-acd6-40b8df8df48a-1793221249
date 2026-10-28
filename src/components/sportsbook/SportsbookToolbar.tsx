import { Radio, Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SportsbookView = "all" | "live" | "upcoming" | "favorites";
export type SportsbookSort = "soonest" | "markets" | "odds" | "league";

interface SportsbookToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  view: SportsbookView;
  onViewChange: (value: SportsbookView) => void;
  sort: SportsbookSort;
  onSortChange: (value: SportsbookSort) => void;
  resultCount: number;
  favoriteCount: number;
  liveOnly?: boolean;
}

const viewOptions: Array<{ value: SportsbookView; label: string }> = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "favorites", label: "Favourites" },
];

export function SportsbookToolbar({
  query,
  onQueryChange,
  view,
  onViewChange,
  sort,
  onSortChange,
  resultCount,
  favoriteCount,
  liveOnly = false,
}: SportsbookToolbarProps) {
  const visibleViews = liveOnly
    ? viewOptions.filter((option) => option.value !== "upcoming")
    : viewOptions;

  return (
    <div className="surface rounded-md border border-border p-2.5 space-y-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search team, league or sport"
            aria-label="Search sportsbook events"
            className="h-9 border-border bg-background pl-9 text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SportsbookSort)}
            className="h-9 min-w-[155px] rounded border border-border bg-background px-2.5 text-xs font-semibold text-foreground"
            aria-label="Sort sportsbook events"
          >
            <option value="soonest">Starting soon</option>
            <option value="markets">Most markets</option>
            <option value="odds">Highest odds</option>
            <option value="league">League A–Z</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {visibleViews.map((option) => {
          const active = view === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onViewChange(option.value)}
              className={cn(
                "h-7 flex-shrink-0 px-2.5 text-[10px] font-bold",
                active && "border-primary bg-primary/10 text-primary"
              )}
            >
              {option.value === "live" && <Radio className="mr-1 h-3 w-3" />}
              {option.value === "favorites" && <Star className="mr-1 h-3 w-3" />}
              {option.label}
              {option.value === "favorites" && favoriteCount > 0 && (
                <span className="ml-1 rounded bg-primary/15 px-1 font-mono">{favoriteCount}</span>
              )}
            </Button>
          );
        })}
        <span className="ml-auto flex-shrink-0 text-[10px] font-semibold text-muted-foreground">
          {resultCount} {resultCount === 1 ? "event" : "events"}
        </span>
      </div>
    </div>
  );
}
