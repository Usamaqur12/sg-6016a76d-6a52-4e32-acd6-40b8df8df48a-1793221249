import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface SportsEntityBadgeProps {
  imageUrl?: string | null;
  label: string;
  className?: string;
}

function initials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "•";
}

export function SportsEntityBadge({ imageUrl, label, className }: SportsEntityBadgeProps) {
  const [failed, setFailed] = useState(false);
  const fallback = useMemo(() => initials(label), [label]);

  useEffect(() => setFailed(false), [imageUrl]);

  if (imageUrl && !failed) {
    return (
      // Provider assets can be hosted on several approved sports CDNs.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        alt={`${label} logo`}
        title={label}
        className={cn("inline-block h-5 w-5 shrink-0 rounded-full border border-white/15 bg-white/90 object-contain p-0.5 shadow-sm", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      aria-label={`${label} badge`}
      title={label}
      className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[8px] font-black leading-none text-primary", className)}
    >
      {fallback}
    </span>
  );
}
