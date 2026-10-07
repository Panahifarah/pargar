import Image from "next/image";
import { cn } from "@/lib/utils";
import logoSrc from "../../public/logo.png";

type BrandMarkProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Persian brand by default; pass "en" for Latin "Pargar" */
  locale?: "en" | "fa";
  /** Show the Pargar logo mark (default true) */
  showLogo?: boolean;
  /** Logo image only, no wordmark */
  logoOnly?: boolean;
};

const sizeClass = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-3xl sm:text-4xl",
};

const logoPx = {
  sm: 28,
  md: 36,
  lg: 56,
};

/** پرگار / Pargar */
export function BrandMark({
  className,
  size = "md",
  locale = "fa",
  showLogo = true,
  logoOnly = false,
}: BrandMarkProps) {
  const px = logoPx[size];
  const label = locale === "en" ? "Pargar" : "پرگار";

  const wordmark =
    locale === "en" ? (
      <span dir="ltr" className={cn("font-extrabold tracking-tight", sizeClass[size], className)}>
        Par<span className="text-primary">gar</span>
      </span>
    ) : (
      <span className={cn("font-extrabold tracking-tight", sizeClass[size], className)}>
        پر<span className="text-primary">گار</span>
      </span>
    );

  return (
    <span className="inline-flex items-center gap-2" aria-label={logoOnly ? label : undefined}>
      {showLogo && (
        <Image
          src={logoSrc}
          alt={logoOnly ? label : ""}
          width={px}
          height={px}
          className={cn(
            "shrink-0 rounded-xl bg-white object-contain shadow-offset-sm",
            size === "sm" && "rounded-lg",
            size === "lg" && "rounded-2xl"
          )}
          priority={size === "lg"}
        />
      )}
      {!logoOnly && wordmark}
    </span>
  );
}
