import { kolbabaTile } from "@/lib/kolbaba-icon";

export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className={className}>
      {kolbabaTile({ small: size <= 32 })}
    </svg>
  );
}
