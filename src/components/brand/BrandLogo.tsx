import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  admin?: boolean;
  compact?: boolean;
  className?: string;
};

export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-emerald-300/25 bg-gradient-to-br from-emerald-300 via-emerald-500 to-cyan-500 shadow-[0_0_24px_rgba(16,185,129,0.28)] ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className="h-[72%] w-[72%]" fill="none">
        <path d="M8 34V14l8.5 10L24 14l7.5 10L40 14v20" stroke="#04130f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M29 9h10v10" stroke="#ecfeff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m29 19 10-10" stroke="#ecfeff" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
      <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.9)]" />
    </span>
  );
}

export function BrandLogo({ href = "/", admin = false, compact = false, className = "" }: BrandLogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark className={compact ? "h-8 w-8" : "h-10 w-10"} />
      <span className="min-w-0 leading-none">
        <span className={`${compact ? "text-base" : "text-xl"} block whitespace-nowrap font-black tracking-[-0.04em] text-foreground`}>
          MindBet <span className="text-primary">Pro</span>
        </span>
        <span className="mt-1 block whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {admin ? "Admin Control" : "mindbetpro.com"}
        </span>
      </span>
    </span>
  );

  return href ? <Link href={href} aria-label={admin ? "MindBet Pro admin" : "MindBet Pro home"}>{content}</Link> : content;
}
