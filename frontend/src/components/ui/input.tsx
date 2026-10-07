import * as React from "react";
import { cn } from "@/lib/utils";

const LATIN_INPUT_TYPES = new Set(["password", "email", "url", "tel"]);

function wantsLatinDigits(props: React.InputHTMLAttributes<HTMLInputElement>): boolean {
  const type = props.type ?? "text";
  if (LATIN_INPUT_TYPES.has(type)) return true;
  if (props.dir === "ltr") return true;
  const ac = (props.autoComplete ?? "").toLowerCase();
  if (
    ac === "username" ||
    ac === "email" ||
    ac.includes("password") ||
    ac === "one-time-code" ||
    ac === "tel" ||
    ac === "url"
  ) {
    return true;
  }
  const id = `${props.id ?? ""} ${props.name ?? ""}`.toLowerCase();
  if (id.includes("captcha") || id.includes("password") || id.includes("username") || id.includes("email")) {
    return true;
  }
  return false;
}

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    const latin = wantsLatinDigits({ type, ...props });
    return (
      <input
        type={type}
        className={cn(
          // Fixed height + symmetric vertical padding; avoid clipping Vazirmatn descenders.
          "box-border h-11 w-full rounded-lg border border-input bg-card px-3.5 py-0 font-sans text-sm font-medium leading-none outline-none transition-colors placeholder:font-sans placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          latin && "font-latin placeholder:font-latin",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
