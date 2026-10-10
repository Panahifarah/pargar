import { Snowflake } from "lucide-react";

export function isAccountMonochrome(account?: { isFrozen?: boolean; isClosed?: boolean } | null) {
  return Boolean(account?.isFrozen || account?.isClosed);
}

export function FreezeMark({ closed }: { closed?: boolean }) {
  const label = closed ? "حساب بسته شده" : "حساب فریز شده";
  return (
    <Snowflake
      aria-hidden={false}
      role="img"
      aria-label={label}
      className="size-[0.85em] shrink-0"
    />
  );
}
