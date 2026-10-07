"use client";

import { useMemo } from "react";
import DatePicker, { DateObject } from "react-multi-date-picker";
import TimePicker from "react-multi-date-picker/plugins/time_picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { cn } from "@/lib/utils";

type Props = {
  value?: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Accessible label for the input */
  "aria-label"?: string;
};

function toDateObject(iso: string | undefined): DateObject | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return new DateObject({ date: d, calendar: persian, locale: persian_fa });
}

function toIso(obj: DateObject | null | undefined): string {
  if (!obj) return "";
  const js = obj.toDate();
  if (Number.isNaN(js.getTime())) return "";
  return js.toISOString();
}

/** Jalali calendar + time; value/onChange use ISO UTC strings for the API. */
export function JalaliDateTimePicker({ value, onChange, disabled, className, id, "aria-label": ariaLabel }: Props) {
  const selected = useMemo(() => toDateObject(value), [value]);

  return (
    <DatePicker
      id={id}
      value={selected}
      onChange={(date) => {
        if (Array.isArray(date)) {
          onChange(toIso(date[0] ?? null));
          return;
        }
        onChange(toIso(date));
      }}
      calendar={persian}
      locale={persian_fa}
      format="YYYY/MM/DD HH:mm"
      plugins={[<TimePicker key="time" position="bottom" hideSeconds />]}
      calendarPosition="bottom-right"
      disabled={disabled}
      editable={false}
      inputClass={cn(
        "box-border h-11 w-full rounded-lg border border-input bg-card px-3.5 py-0 font-sans text-sm font-medium leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      containerClassName="w-full"
      aria-label={ariaLabel}
    />
  );
}

/** True when both ISO strings parse and end >= start. */
export function isValidIsoRange(startsAt: string, endsAt: string): boolean {
  if (!startsAt || !endsAt) return false;
  const a = new Date(startsAt).getTime();
  const b = new Date(endsAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b >= a;
}
