"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { http } from "@/lib/api";

type Hit = { kind: string; title: string; href: string };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void http
        .get<{ results: Hit[] }>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((res) => setHits(res.results ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative min-w-0 w-28 sm:w-56">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="جستجو"
        className="h-9 w-full rounded-full border border-border bg-background/70 ps-8 pe-3 text-sm outline-none focus:border-primary"
      />
      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-lg">
          {hits.map((h) => (
            <button
              key={h.kind + h.href + h.title}
              type="button"
              className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                setQ("");
                router.push(h.href);
              }}
            >
              <span className="text-[10px] text-muted-foreground">{h.kind}</span>
              <span className="block truncate font-bold">{h.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
