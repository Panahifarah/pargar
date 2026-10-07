"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, dir, autoComplete, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  // Default LTR for real passwords; callers can pass dir="rtl" for Persian secrets (e.g. security answer).
  const resolvedDir = dir ?? "ltr";
  const isRtl = resolvedDir === "rtl";

  return (
    <div className="relative">
      <Input
        ref={ref}
        {...props}
        type={visible ? "text" : "password"}
        dir={resolvedDir}
        autoComplete={autoComplete ?? "current-password"}
        className={cn(
          // Physical padding/toggle side so RTL page chrome cannot flip the eye away from the gutter.
          "font-latin placeholder:font-latin pr-11",
          isRtl ? "text-right" : "text-left",
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "مخفی کردن رمز" : "نمایش رمز"}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
