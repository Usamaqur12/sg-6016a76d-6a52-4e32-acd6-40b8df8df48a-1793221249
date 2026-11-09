import { cn } from "@/lib/utils";

interface CountryFlagProps {
  code?: string | null;
  label?: string;
  className?: string;
}

export function CountryFlag({ code, label, className }: CountryFlagProps) {
  if (!code) return null;
  const normalized = code.toLowerCase();
  return (
    // The country flag is presentation data; alt text retains the country/team context.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/24x18/${encodeURIComponent(normalized)}.png`}
      srcSet={`https://flagcdn.com/48x36/${encodeURIComponent(normalized)}.png 2x`}
      width={24}
      height={18}
      loading="lazy"
      decoding="async"
      alt={label ? `${label} flag` : `${normalized.toUpperCase()} flag`}
      title={label || normalized.toUpperCase()}
      className={cn("inline-block h-3.5 w-[19px] shrink-0 rounded-[2px] border border-white/15 object-cover shadow-sm", className)}
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  );
}

