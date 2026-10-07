"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFaNumber } from "@/lib/utils";

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const DEFAULT_PAGE_SIZE = 10;

export function buildPageQuery(page: number, pageSize = DEFAULT_PAGE_SIZE): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (total <= 0) {
    return null;
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    return (
      <p className={className ?? "mt-2 pt-4 text-xs text-muted-foreground"}>
        {formatFaNumber(total)} مورد
      </p>
    );
  }
  return (
    <div
      className={
        className ??
        "mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground"
      }
    >
      <p>
        صفحه {formatFaNumber(page)} از {formatFaNumber(totalPages)}
        {" · "}
        {formatFaNumber(total)} مورد
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
          قبلی
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          بعدی
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
