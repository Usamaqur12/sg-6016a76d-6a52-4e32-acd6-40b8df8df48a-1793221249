import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Loader2, Search, Trophy } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { searchSportsbook, type SportsbookSearchResult } from "@/services/discoveryService";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SportsbookSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setResults([]);
      setError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      const response = await searchSportsbook(search);
      setResults(response.results);
      setError(response.error || null);
      setLoading(false);
    }, search ? 250 : 0);

    return () => window.clearTimeout(timer);
  }, [isOpen, search]);

  async function openResult(result: SportsbookSearchResult) {
    onClose();
    await router.push(result.href);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0">
        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search real events, teams, leagues and sports..."
              className="pl-10 pr-10 bg-surface border-border"
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />}
          </div>
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-2">
            {error ? (
              <div className="py-8 text-center text-sm text-danger">Search is temporarily unavailable</div>
            ) : !loading && results.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                {search ? "No matching sportsbook records" : "No active events available"}
              </div>
            ) : (
              <div className="space-y-1">
                {!search && results.length > 0 && (
                  <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Upcoming & live</p>
                )}
                {results.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => void openResult(result)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-surface transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center flex-shrink-0">
                      {result.icon ? <span className="text-lg">{result.icon}</span> : <Trophy className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{result.title}</p>
                        {result.isLive && <Badge variant="destructive" className="h-4 px-1 text-[9px]">LIVE</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] uppercase">{result.type}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{results.length} verified result{results.length === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
