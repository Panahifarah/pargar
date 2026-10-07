/** Shared field validators — keep messages/rules aligned with backend/internal/api/validate.go */

export const MSG = {
  nameRequired: "نام الزامی است",
  nameTooLong: "نام خیلی طولانی است",
  emailInvalid: "ایمیل نامعتبر است",
  usernameInvalid:
    "شناسه باید با حرف انگلیسی شروع شود و ۳ تا ۳۲ نویسهٔ لاتین، عدد، نقطه، خط یا زیرخط باشد",
  passwordShort: "گذرواژه باید دست‌کم ۸ نویسه داشته باشد",
  passwordLong: "گذرواژه بیش از حد طولانی است",
  passwordMismatch: "گذرواژه و تکرار آن یکسان نیستند",
  phoneRequired: "شماره تلفن الزامی است",
  phoneInvalid: "شماره تلفن نامعتبر است (مثال: ۰۹۱۲۱۲۳۴۵۶۷)",
  secQARequired: "سوال و جواب امنیتی الزامی است",
  secQShort: "سوال امنیتی خیلی کوتاه است",
  secQLong: "سوال امنیتی خیلی طولانی است",
  secAShort: "جواب امنیتی خیلی کوتاه است",
  secALong: "جواب امنیتی خیلی طولانی است",
  inviteLabelLong: "برچسب لینک عضویت خیلی طولانی است",
} as const;

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;

/** Max visible length while typing (+989xxxxxxxxx). Canonical form is 11 digits. */
export const PHONE_INPUT_MAX_LEN = 13;

function mapDigitChar(ch: string): string | null {
  const code = ch.codePointAt(0)!;
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (ch >= "0" && ch <= "9") return ch;
  return null;
}

/** Map Persian/Arabic digits to ASCII and canonicalize Iranian mobiles to 09XXXXXXXXX. */
export function normalizePhone(raw: string): string {
  let digits = "";
  for (const ch of raw.trim()) {
    const d = mapDigitChar(ch);
    if (d !== null) digits += d;
  }
  if (digits.length === 12 && digits.startsWith("989")) {
    return `0${digits.slice(2)}`;
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return `0${digits}`;
  }
  return digits;
}

/**
 * Limit phone typing to a plausible Iranian mobile length.
 * Allows 09… (11), 9… (10), 98… / +98… (12 digits) — nothing beyond that.
 */
export function clampPhoneInput(raw: string): string {
  let plus = false;
  let digits = "";
  for (const ch of raw) {
    if (ch === "+" && digits.length === 0 && !plus) {
      plus = true;
      continue;
    }
    const d = mapDigitChar(ch);
    if (d === null) continue;
    const next = digits + d;
    if (next.startsWith("98")) {
      if (next.length > 12) continue;
    } else if (next.startsWith("09") || next.startsWith("0")) {
      if (next.length > 11) continue;
    } else if (next.startsWith("9")) {
      if (next.length > 10) continue;
    } else if (next.length > 11) {
      continue;
    }
    digits = next;
  }
  if (plus && (digits === "" || digits.startsWith("9"))) {
    return `+${digits}`;
  }
  return digits;
}

export function validateName(v: string): string | null {
  const name = v.trim();
  if (!name) return MSG.nameRequired;
  if ([...name].length > 100) return MSG.nameTooLong;
  return null;
}

export function validateUsername(v: string): string | null {
  const u = v.trim().toLowerCase();
  if (!u) return "شناسه کاربری الزامی است";
  if (!USERNAME_RE.test(u)) return MSG.usernameInvalid;
  return null;
}

export function validateEmail(v: string): string | null {
  const e = v.trim().toLowerCase();
  if (!e) return "ایمیل الزامی است";
  if (e.length > 200 || /\s/.test(e)) return MSG.emailInvalid;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return MSG.emailInvalid;
  return null;
}

export function validatePhone(v: string, required = true): string | null {
  const phone = normalizePhone(v);
  if (!phone) return required ? MSG.phoneRequired : null;
  if (!/^09\d{9}$/.test(phone)) return MSG.phoneInvalid;
  return null;
}

export function validatePassword(password: string, confirm?: string): string | null {
  if (password.length < 8) return MSG.passwordShort;
  if (password.length > 72) return MSG.passwordLong;
  if (confirm !== undefined && password !== confirm) return MSG.passwordMismatch;
  return null;
}

export function validateSecurityQA(question: string, answer: string): string | null {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return MSG.secQARequired;
  if ([...q].length < 3) return MSG.secQShort;
  if ([...q].length > 200) return MSG.secQLong;
  if ([...a].length < 2) return MSG.secAShort;
  if ([...a].length > 100) return MSG.secALong;
  return null;
}

export function validateInviteLabel(label: string): string | null {
  if ([...label.trim()].length > 80) return MSG.inviteLabelLong;
  return null;
}
