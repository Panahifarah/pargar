"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

type Pending = {
  title: string;
  description: string;
  confirmLabel?: string;
  resolve: (ok: boolean) => void;
};

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const settledRef = useRef(false);

  const confirm = useCallback((title: string, description: string, confirmLabel?: string) => {
    return new Promise<boolean>((resolve) => {
      settledRef.current = false;
      setPending({ title, description, confirmLabel, resolve });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    if (settledRef.current || !pending) {
      return;
    }
    settledRef.current = true;
    const p = pending;
    setPending(null);
    p.resolve(ok);
  }, [pending]);

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel={pending?.confirmLabel}
      onOpenChange={(open) => {
        if (!open) {
          settle(false);
        }
      }}
      onConfirm={() => settle(true)}
    />
  );

  return { confirm, dialog };
}
