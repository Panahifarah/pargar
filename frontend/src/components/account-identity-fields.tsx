"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-bold text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** نام، ایمیل، تلفن — same block on /settings and in the admin account editor. */
export function AccountIdentityFields({
  idPrefix,
  name,
  email,
  phone,
  onName,
  onEmail,
  onPhone,
  phoneMaxLength,
  action,
}: {
  idPrefix: string;
  name: string;
  email: string;
  phone: string;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  phoneMaxLength?: number;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4" aria-labelledby={`${idPrefix}-identity-heading`}>
      <h3 id={`${idPrefix}-identity-heading`} className="text-sm font-black">هویت</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-name`} label="نام">
          <Input id={`${idPrefix}-name`} value={name} onChange={(e) => onName(e.target.value)} autoComplete="name" />
        </Field>
        <Field id={`${idPrefix}-email`} label="ایمیل">
          <Input
            id={`${idPrefix}-email`}
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            dir="ltr"
            autoComplete="email"
            inputMode="email"
          />
        </Field>
        <Field id={`${idPrefix}-phone`} label="تلفن">
          <Input
            id={`${idPrefix}-phone`}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            dir="ltr"
            autoComplete="tel"
            inputMode="tel"
            maxLength={phoneMaxLength}
          />
        </Field>
      </div>
      {action}
    </section>
  );
}

type UsernameSelf = {
  mode: "self";
  idPrefix: string;
  current: string;
  next: string;
  onNext: (value: string) => void;
  disabled?: boolean;
  hint?: ReactNode;
  action?: ReactNode;
};

type UsernameAdmin = {
  mode: "admin";
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
};

/** نام کاربری follows هویت. Self-service keeps the cooldown fields; admin sets the name directly. */
export function AccountUsernameSection(props: UsernameSelf | UsernameAdmin) {
  const headingId = `${props.idPrefix}-username-heading`;
  return (
    <section className="space-y-3 border-t border-border pt-6" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-black">نام کاربری</h3>
      {props.mode === "self" && props.hint}
      {props.mode === "self" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${props.idPrefix}-username-current`} label="نام کاربری فعلی">
            <Input
              id={`${props.idPrefix}-username-current`}
              value={props.current}
              readOnly
              dir="ltr"
              autoComplete="username"
            />
          </Field>
          <Field id={`${props.idPrefix}-username`} label="نام کاربری جدید">
            <Input
              id={`${props.idPrefix}-username`}
              value={props.next}
              onChange={(e) => props.onNext(e.target.value.toLowerCase())}
              dir="ltr"
              autoComplete="off"
              disabled={props.disabled}
            />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${props.idPrefix}-username`} label="نام کاربری">
            <Input
              id={`${props.idPrefix}-username`}
              value={props.value}
              onChange={(e) => props.onChange(e.target.value.toLowerCase())}
              dir="ltr"
              autoComplete="off"
              placeholder="مثلاً ahp"
            />
          </Field>
        </div>
      )}
      {props.mode === "self" ? props.action : null}
    </section>
  );
}
