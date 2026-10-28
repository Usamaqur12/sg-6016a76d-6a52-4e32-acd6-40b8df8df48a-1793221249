import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

const promos = [
  {
    id: 1,
    title: "Welcome Bonus",
    subtitle: "Get started with exclusive welcome offers and promotions!",
    cta: "Get Started",
    href: "/auth/register",
    gradient: "from-primary/15 via-primary/5 to-transparent",
  },
  {
    id: 2,
    title: "Live Cricket Markets",
    subtitle: "Follow live cricket scores and place your bets",
    cta: "Bet Now",
    href: "/live?sport=cricket",
    gradient: "from-success/15 via-success/5 to-transparent",
  },
  {
    id: 3,
    title: "Premier League Weekend",
    subtitle: "Best odds on all top-flight English football matches",
    cta: "View Matches",
    href: "/sports?sport=football",
    gradient: "from-gold/15 via-gold/5 to-transparent",
  },
];

export function PromoCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % promos.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const goToPrevious = () => {
    setCurrent((prev) => (prev - 1 + promos.length) % promos.length);
  };

  const goToNext = () => {
    setCurrent((prev) => (prev + 1) % promos.length);
  };

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-md border border-primary/20">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {promos.map((promo) => (
            <div
              key={promo.id}
              className={cn(
                "w-full flex-shrink-0 p-3",
                "bg-gradient-to-br",
                promo.gradient
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold mb-0.5 text-primary">
                    {promo.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {promo.subtitle}
                  </p>
                </div>
                <Button asChild className="bg-primary hover:bg-primary/90 font-bold text-xs h-8 px-4 shadow-sm flex-shrink-0 transition-smooth"><Link href={promo.href}>{promo.cta}</Link></Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="absolute inset-y-0 left-0 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full bg-background/80 hover:bg-background border border-border ml-1"
          onClick={goToPrevious}
        >
          <ChevronLeft className="h-3 w-3" />
        </Button>
      </div>
      <div className="absolute inset-y-0 right-0 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full bg-background/80 hover:bg-background border border-border mr-1"
          onClick={goToNext}
        >
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>

      {/* Indicators */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1">
        {promos.map((_, idx) => (
          <button
            key={idx}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              idx === current
                ? "w-4 bg-primary"
                : "w-1 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            )}
            onClick={() => setCurrent(idx)}
          />
        ))}
      </div>
    </div>
  );
}
