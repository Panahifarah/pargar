"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Flame, Sparkles } from "lucide-react";
import { AccountIdentityFields, AccountUsernameSection } from "@/components/account-identity-fields";
import { SectionColumns, SectionNav, SectionPanel } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, http, toUserError } from "@/lib/api";
import { validateEmail, validateName, validatePassword, validatePhone, validateUsername } from "@/lib/validation";
import { useAuth } from "@/lib/auth-store";
import { clearMediaCache } from "@/lib/transfer";
import { toast } from "@/components/providers";
import type { Conversation } from "@/lib/types";
import { formatFaNumber, formatJalaliStamp, formatStreakLabel } from "@/lib/utils";

type SocialLink = { name: string; url: string };

type Extras = {
  banner: string;
  public: boolean;
  showActivity: boolean;
  showStats: boolean;
  showPath: boolean;
  showBadges: boolean;
  socialLinks: SocialLink[];
  theme: string;
};

type Activity = { days: { day: string; count: number }[]; weekDays: number; monthDays: number };
type BadgeItem = { id: string; title: string; unlocked: boolean };

const SECTIONS = [
  { id: "account", label: "حساب", title: "حساب", description: "نام، ایمیل و تلفن را اینجا ذخیره می‌کنید. نام کاربری جدا عوض می‌شود. برای گذرواژه، گذرواژهٔ فعلی لازم است." },
  { id: "privacy", label: "حریم", title: "حریم", description: "مشخص کنید دیگران در پروفایل شما چه چیزی ببینند." },
  { id: "stats", label: "آمار", title: "آمار", description: "امتیاز، زنجیره و نشان‌های همین حساب." },
  { id: "export", label: "خروجی", title: "خروجی", description: "گفتگوها را دانلود کنید یا حافظه موقت را از همین دستگاه حذف کنید." },
] as const;

const EXPORT_PAGE_SIZE = 8;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const profileQ = useQuery({
    queryKey: ["me-profile"],
    queryFn: () => http.get<{ profile: Extras }>("/api/me/profile"),
    enabled: !!user,
  });
  const activityQ = useQuery({
    queryKey: ["me-activity"],
    queryFn: () => http.get<Activity>("/api/me/activity"),
    enabled: !!user && (profileQ.data?.profile.showActivity ?? true),
  });
  const badgesQ = useQuery({
    queryKey: ["me-achievements"],
    queryFn: () => http.get<{ achievements: BadgeItem[] }>("/api/me/achievements"),
    enabled: !!user && (profileQ.data?.profile.showBadges ?? true),
  });
  const [section, setSection] = useState<SectionId>("account");
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [exportPage, setExportPage] = useState(1);
  const exportChatsQ = useQuery({
    queryKey: ["settings-export-chats", user?.id],
    queryFn: () => http.get<{ conversations: Conversation[] }>("/api/chats/conversations"),
    enabled: !!user && section === "export",
  });
  const exportChats = exportChatsQ.data?.conversations ?? [];
  const exportPageCount = Math.max(1, Math.ceil(exportChats.length / EXPORT_PAGE_SIZE));
  const exportPageSafe = Math.min(Math.max(exportPage, 1), exportPageCount);
  const exportPageStart = (exportPageSafe - 1) * EXPORT_PAGE_SIZE;
  const exportPageChats = exportChats.slice(exportPageStart, exportPageStart + EXPORT_PAGE_SIZE);
  const exportSizes = useQueries({
    queries: exportChats.map((chat) => ({
      queryKey: ["me-export-meta", user?.id, chat.partner.id],
      queryFn: () => http.get<{ bytes: number; chat: number; lastAt?: string }>(`/api/me/export?meta=1&chat=${chat.partner.id}`),
      enabled: !!user && section === "export",
    })),
  });
  const [form, setForm] = useState<Extras | null>(null);
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [nextUsername, setNextUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [identityDirty, setIdentityDirty] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [freezeConfirm, setFreezeConfirm] = useState(false);
  const [freezePassword, setFreezePassword] = useState("");
  const [freezeBusy, setFreezeBusy] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const profile = profileQ.data?.profile;
    if (!profile) return;
    setForm({
      ...profile,
      socialLinks: normalizeLinks(profile.socialLinks),
    });
  }, [profileQ.data]);

  useEffect(() => {
    if (!user || identityDirty) return;
    setDisplayName(user.name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
  }, [user, identityDirty]);

  if (!user) return null;

  const usernameCooling = Boolean(
    user.usernameCooldownUntil && new Date(user.usernameCooldownUntil).getTime() > Date.now(),
  );
  const usernameRemaining = user.usernameChangesRemaining ?? 3;
  const active = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const activityOn = profileQ.data?.profile.showActivity ?? true;
  const badgesOn = profileQ.data?.profile.showBadges ?? true;

  const patch = (partial: Partial<Extras>) => {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const saveProfile = async () => {
    if (!form) return;
    try {
      await http.put("/api/me/profile", {
        public: form.public,
        showActivity: form.showActivity,
        showStats: form.showStats,
        showPath: form.showPath,
        showBadges: form.showBadges,
        socialLinks: form.socialLinks.slice(0, 5),
        banner: form.banner,
      });
      toast.success("تنظیمات ذخیره شد");
    } catch (e) {
      toast.error(toUserError(e, "ذخیره ممکن نشد"));
    }
  };

  const saveIdentity = async () => {
    const nameErr = validateName(displayName);
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    const emailErr = validateEmail(email);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    const phoneErr = validatePhone(phone, false);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }
    setSavingIdentity(true);
    try {
      const res = await http.put<{ user: typeof user }>("/api/me/account", {
        name: displayName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
      });
      setUser(res.user);
      setDisplayName(res.user.name ?? "");
      setEmail(res.user.email ?? "");
      setPhone(res.user.phone ?? "");
      setIdentityDirty(false);
      toast.success("مشخصات ذخیره شد");
    } catch (e) {
      toast.error(toUserError(e, "ذخیره مشخصات ممکن نشد"));
    } finally {
      setSavingIdentity(false);
    }
  };

  const changeUsername = async () => {
    const err = validateUsername(nextUsername);
    if (err) {
      toast.error(err);
      return;
    }
    const next = nextUsername.trim().toLowerCase();
    if (next === user.username) {
      toast.success("نام کاربری همان است");
      return;
    }
    setSavingUsername(true);
    try {
      const res = await http.put<{ user: typeof user }>("/api/me/username", { username: next });
      setUser(res.user);
      setNextUsername("");
      toast.success("نام کاربری تغییر کرد");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 429)) {
        toast.error(toUserError(e, "تغییر نام کاربری ممکن نشد"));
      }
    } finally {
      setSavingUsername(false);
    }
  };

  const savePassword = async () => {
    const err = validatePassword(password);
    if (err) {
      toast.error(err);
      return;
    }
    setSavingPassword(true);
    try {
      const res = await http.put<{ user: typeof user }>("/api/me/account", {
        currentPassword,
        password,
      });
      setUser(res.user);
      setPassword("");
      setCurrentPassword("");
      toast.success("گذرواژه ذخیره شد");
    } catch (e) {
      toast.error(toUserError(e, "تغییر گذرواژه ممکن نشد"));
    } finally {
      setSavingPassword(false);
    }
  };

  const freezeAccount = async () => {
    if (!freezeConfirm) {
      setFreezeConfirm(true);
      return;
    }
    if (!freezePassword.trim()) {
      toast.error("گذرواژهٔ فعلی را بنویسید");
      return;
    }
    setFreezeBusy(true);
    try {
      const res = await http.post<{ user: typeof user }>("/api/me/freeze", { currentPassword: freezePassword });
      setUser(res.user);
      setFreezeConfirm(false);
      setFreezePassword("");
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("حساب فریز شد");
    } catch (e) {
      toast.error(toUserError(e, "فریز حساب ممکن نشد"));
    } finally {
      setFreezeBusy(false);
    }
  };

  const unfreezeAccount = async () => {
    setFreezeBusy(true);
    try {
      const res = await http.post<{ user: typeof user }>("/api/me/unfreeze");
      setUser(res.user);
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("فریز لغو شد");
    } catch (e) {
      toast.error(toUserError(e, "لغو فریز ممکن نشد"));
    } finally {
      setFreezeBusy(false);
    }
  };

  const closeDate = formatFreezeCloseDate(user.closesAt || freezeCloseIso(user.frozenAt));

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-black tracking-tight">تنظیمات</h1>
        <p className="text-sm text-muted-foreground">حساب، حریم و داده‌های همین حساب.</p>
      </header>

      <SectionColumns>
        <SectionNav
          label="بخش‌های تنظیمات"
          groups={[{ items: SECTIONS.map((item) => ({ id: item.id, label: item.label })) }]}
          activeId={section}
          onSelect={setSection}
        />

        <SectionPanel
          id="settings-section"
          titleId="settings-section-title"
          title={active.title}
          description={active.description}
        >
            {section === "account" && (
              <div className="space-y-8">
                <AccountIdentityFields
                  idPrefix="settings"
                  name={displayName}
                  email={email}
                  phone={phone}
                  onName={(value) => {
                    setIdentityDirty(true);
                    setDisplayName(value);
                  }}
                  onEmail={(value) => {
                    setIdentityDirty(true);
                    setEmail(value);
                  }}
                  onPhone={(value) => {
                    setIdentityDirty(true);
                    setPhone(value);
                  }}
                  action={
                    <Button type="button" disabled={savingIdentity} onClick={() => void saveIdentity()}>
                      ذخیره مشخصات
                    </Button>
                  }
                />

                <AccountUsernameSection
                  mode="self"
                  idPrefix="settings"
                  current={user.username}
                  next={nextUsername}
                  onNext={setNextUsername}
                  disabled={usernameCooling}
                  hint={
                    usernameCooling && user.usernameCooldownUntil ? (
                      <p className="text-sm text-muted-foreground">
                        سه بار نام کاربری را عوض کرده‌اید. تغییر بعدی از {formatJalaliStamp(user.usernameCooldownUntil)} ممکن است.
                      </p>
                    ) : usernameAllowanceLabel(usernameRemaining) ? (
                      <p className="text-xs font-bold text-muted-foreground">{usernameAllowanceLabel(usernameRemaining)}</p>
                    ) : null
                  }
                  action={
                    <Button
                      type="button"
                      disabled={usernameCooling || savingUsername || usernameRemaining <= 0}
                      onClick={() => void changeUsername()}
                    >
                      تغییر نام کاربری
                    </Button>
                  }
                />

                <section className="space-y-4 border-t border-border pt-6" aria-labelledby="settings-password-heading">
                  <div className="space-y-1">
                    <h3 id="settings-password-heading" className="text-sm font-black">گذرواژه</h3>
                    <p className="text-xs text-muted-foreground">برای ذخیره، گذرواژهٔ فعلی لازم است.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="settings-new-password" label="گذرواژهٔ جدید">
                      <PasswordInput
                        id="settings-new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        dir="ltr"
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field id="settings-current-password" label="گذرواژهٔ فعلی">
                      <PasswordInput
                        id="settings-current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        dir="ltr"
                        autoComplete="current-password"
                      />
                    </Field>
                  </div>
                  <Button type="button" disabled={savingPassword} onClick={() => void savePassword()}>
                    ذخیره
                  </Button>
                </section>

                <section className="space-y-3 border-t border-border pt-6" aria-labelledby="settings-freeze-heading">
                  <h3 id="settings-freeze-heading" className="text-sm font-black">فریز حساب</h3>
                  <p className="text-sm text-muted-foreground">
                    فریز تا ۳۰ روز قابل بازگشت است، بعد از آن حساب بسته می‌شود و حذف دائمی فقط با مجوز ادمین است.
                  </p>
                  {user.isClosed ? (
                    <p className="text-sm font-bold">حساب بسته شده است. لغو فریز ممکن نیست.</p>
                  ) : user.isFrozen ? (
                    <div className="space-y-3">
                      <p className="text-sm">
                        {closeDate ? `این حساب در ${closeDate} بسته می‌شود.` : "این حساب تا ۳۰ روز دیگر بسته می‌شود."}
                      </p>
                      <Button type="button" variant="outline" disabled={freezeBusy} onClick={() => void unfreezeAccount()}>
                        لغو فریز
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {freezeConfirm && (
                        <>
                          <p className="text-sm font-bold">برای فریز، گذرواژهٔ فعلی را بنویسید.</p>
                          <Field id="settings-freeze-password" label="گذرواژهٔ فعلی">
                            <PasswordInput
                              id="settings-freeze-password"
                              value={freezePassword}
                              onChange={(e) => setFreezePassword(e.target.value)}
                              dir="ltr"
                              autoComplete="current-password"
                            />
                          </Field>
                        </>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant={freezeConfirm ? "destructive" : "outline"} disabled={freezeBusy} onClick={() => void freezeAccount()}>
                          فریز حساب
                        </Button>
                        {freezeConfirm && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={freezeBusy}
                            onClick={() => {
                              setFreezeConfirm(false);
                              setFreezePassword("");
                            }}
                          >
                            انصراف
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {section === "privacy" && (
              <PrivacyFields
                form={form}
                loading={profileQ.isPending}
                error={profileQ.isError ? toUserError(profileQ.error, "بارگذاری حریم ممکن نشد") : null}
                onPatch={patch}
                onSave={() => void saveProfile()}
              />
            )}

            {section === "stats" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatTile
                    icon={<Sparkles className="h-4 w-4 text-gold" />}
                    label="امتیاز"
                    value={formatFaNumber(user.xp)}
                  />
                  <StatTile
                    icon={<Flame className="h-4 w-4 text-accent" />}
                    label="زنجیرهٔ فعلی"
                    value={formatStreakLabel(user.streakCurrent)}
                  />
                  <StatTile
                    icon={<Flame className="h-4 w-4 text-muted-foreground" />}
                    label="بلندترین زنجیره"
                    value={formatStreakLabel(user.streakLongest)}
                  />
                  <StatTile
                    icon={<CalendarDays className="h-4 w-4 text-primary" />}
                    label="روزهای این هفته"
                    value={countLabel(activityOn, activityQ.isPending, activityQ.data?.weekDays)}
                  />
                  <StatTile
                    icon={<CalendarDays className="h-4 w-4 text-secondary" />}
                    label="روزهای این ماه"
                    value={countLabel(activityOn, activityQ.isPending, activityQ.data?.monthDays)}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-black">نشان‌ها</h3>
                  {badgesOn ? (
                    <div className="mt-3">
                      <p className="mb-3 text-xs text-muted-foreground">رنگ‌دارها باز شده‌اند و کمرنگ‌ها هنوز قفل‌اند.</p>
                      {badgesQ.isPending ? (
                        <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="در حال بارگذاری نشان‌ها">
                          <Skeleton className="h-6 w-24 rounded-full" />
                          <Skeleton className="h-6 w-20 rounded-full" />
                          <Skeleton className="h-6 w-28 rounded-full" />
                        </div>
                      ) : badgesQ.isError ? (
                        <p className="text-sm font-bold text-destructive">{toUserError(badgesQ.error, "بارگذاری نشان‌ها ممکن نشد")}</p>
                      ) : (badgesQ.data?.achievements ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">نشانی ثبت نشده.</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {(badgesQ.data?.achievements ?? []).map((b) => (
                            <li key={b.id}>
                              <Badge variant={b.unlocked ? "success" : "secondary"} className="rounded-full px-2.5 py-1">
                                {b.title}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">نمایش نشان‌ها در بخش حریم خاموش است.</p>
                  )}
                </div>
              </div>
            )}

            {section === "export" && (
              <div className="space-y-6">
                {exportChatsQ.isPending ? (
                  <div className="space-y-3" aria-busy="true" aria-label="در حال بارگذاری گفتگوها">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                ) : exportChatsQ.isError ? (
                  <p className="text-sm font-bold text-destructive">{toUserError(exportChatsQ.error, "بارگذاری گفتگوها ممکن نشد")}</p>
                ) : exportChats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">گفتگویی نیست.</p>
                ) : (
                  <div className="space-y-4">
                    <ul className="divide-y divide-border">
                      {exportPageChats.map((chat, offset) => {
                        const saved = chat.partner.saved || chat.partner.id === user.id;
                        const label = saved ? "پیام‌های ذخیره‌شده" : chat.partner.name;
                        const size = exportSizes[exportPageStart + offset];
                        const last = chat.lastMessage?.createdAt || size?.data?.lastAt;
                        return (
                          <li key={chat.partner.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate text-sm font-bold">{label}</p>
                              <p className="text-xs text-muted-foreground">
                                {last ? `آخرین فعالیت: ${formatJalaliStamp(last)}` : "هنوز پیامی نیست"}
                              </p>
                              <p className="text-xs font-bold text-foreground">
                                {size?.isPending
                                  ? "در حال برآورد حجم…"
                                  : size?.isError
                                    ? "برآورد حجم ممکن نشد"
                                    : `حجم تقریبی: ${formatApproxSize(size?.data?.bytes ?? 0)}`}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              disabled={exportingId === chat.partner.id}
                              onClick={() => {
                                setExportingId(chat.partner.id);
                                void downloadChatExport(chat.partner.id, exportFileName(label, chat.partner.id)).finally(() => {
                                  setExportingId((cur) => (cur === chat.partner.id ? null : cur));
                                });
                              }}
                            >
                              دانلود
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                    {exportChats.length > EXPORT_PAGE_SIZE && (
                      <div className="flex items-center justify-between gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={exportPageSafe <= 1}
                          onClick={() => setExportPage(exportPageSafe - 1)}
                        >
                          قبلی
                        </Button>
                        <p className="text-sm font-bold tabular-nums text-muted-foreground">
                          {formatFaNumber(exportPageSafe)} از {formatFaNumber(exportPageCount)}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={exportPageSafe >= exportPageCount}
                          onClick={() => setExportPage(exportPageSafe + 1)}
                        >
                          بعدی
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              <ul className="divide-y divide-border border-t border-border pt-4">
                <li className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-bold">حذف حافظه موقت</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">عکس و صدای ذخیره‌شده روی همین دستگاه حذف می‌شود.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      void clearMediaCache().then(() => toast.success("حافظه موقت حذف شد"));
                    }}
                  >
                    حذف
                  </Button>
                </li>
              </ul>
              </div>
            )}
        </SectionPanel>
      </SectionColumns>
    </div>
  );
}

function PrivacyFields({
  form,
  loading,
  error,
  onPatch,
  onSave,
}: {
  form: Extras | null;
  loading: boolean;
  error: string | null;
  onPatch: (partial: Partial<Extras>) => void;
  onSave: () => void;
}) {
  if (loading || !form) {
    if (error) return <p className="text-sm font-bold text-destructive">{error}</p>;
    return (
      <div className="space-y-3" aria-busy="true" aria-label="در حال بارگذاری حریم">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
    );
  }

  const links = form.socialLinks;

  return (
    <div className="space-y-6">
      <div className="divide-y divide-border">
        <PrivacyRow
          id="privacy-public"
          label="پروفایل عمومی"
          hint="تا وقتی خاموش باشد، دیگران فقط نام و آواتار را می‌بینند."
          checked={form.public}
          onCheckedChange={(v) => onPatch({ public: v })}
        />
        <PrivacyRow
          id="privacy-activity"
          label="نمایش فعالیت"
          hint="روزهای فعال در پروفایل عمومی دیده می‌شود."
          checked={form.showActivity}
          onCheckedChange={(v) => onPatch({ showActivity: v })}
        />
        <PrivacyRow
          id="privacy-stats"
          label="نمایش آمار"
          hint="امتیاز و زنجیره در پروفایل عمومی دیده می‌شود."
          checked={form.showStats}
          onCheckedChange={(v) => onPatch({ showStats: v })}
        />
        <PrivacyRow
          id="privacy-path"
          label="نمایش مسیر"
          hint="مسیر یادگیری در پروفایل عمومی دیده می‌شود."
          checked={form.showPath}
          onCheckedChange={(v) => onPatch({ showPath: v })}
        />
        <PrivacyRow
          id="privacy-badges"
          label="نمایش نشان‌ها"
          hint="نشان‌ها در پروفایل عمومی دیده می‌شوند."
          checked={form.showBadges}
          onCheckedChange={(v) => onPatch({ showBadges: v })}
        />
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-black">لینک‌های شخصی</h3>
          <p className="mt-1 text-xs text-muted-foreground">حداکثر پنج لینک. نام و نشانی را وارد کنید.</p>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">هنوز لینکی اضافه نشده.</p>
        ) : (
          <ul className="space-y-3">
            {links.map((link, i) => (
              <li key={i} className="flex items-end gap-2">
                <div className="w-28 shrink-0 space-y-1.5 sm:w-36">
                  <Label htmlFor={`settings-link-name-${i}`} className="text-xs font-bold text-muted-foreground">
                    نام
                  </Label>
                  <Input
                    id={`settings-link-name-${i}`}
                    value={link.name}
                    placeholder="تلگرام"
                    onChange={(e) => {
                      const socialLinks = links.map((row, idx) => (idx === i ? { ...row, name: e.target.value } : row));
                      onPatch({ socialLinks });
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`settings-link-url-${i}`} className="text-xs font-bold text-muted-foreground">
                    نشانی
                  </Label>
                  <Input
                    id={`settings-link-url-${i}`}
                    dir="ltr"
                    value={link.url}
                    placeholder="https://"
                    onChange={(e) => {
                      const socialLinks = links.map((row, idx) => (idx === i ? { ...row, url: e.target.value } : row));
                      onPatch({ socialLinks });
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 shrink-0"
                  aria-label={`حذف لینک ${link.name || i + 1}`}
                  onClick={() => onPatch({ socialLinks: links.filter((_, idx) => idx !== i) })}
                >
                  حذف
                </Button>
              </li>
            ))}
          </ul>
        )}
        {links.length < 5 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPatch({ socialLinks: [...links, { name: "", url: "" }] })}
          >
            افزودن لینک
          </Button>
        )}
      </div>

      <Button type="button" onClick={onSave}>
        ذخیره حریم
      </Button>
    </div>
  );
}

function PrivacyRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="text-sm font-bold text-foreground">
          {label}
        </Label>
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={hintId} />
    </div>
  );
}

function formatFreezeCloseDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
}

function freezeCloseIso(frozenAt?: string) {
  if (!frozenAt) return "";
  const start = new Date(frozenAt);
  if (Number.isNaN(start.getTime())) return "";
  const close = new Date(start);
  close.setDate(close.getDate() + 30);
  return close.toISOString();
}

function usernameAllowanceLabel(remaining: number): string {
  if (remaining >= 3) return "۳ بار دیگر";
  if (remaining === 2) return "۲ بار دیگر";
  if (remaining === 1) return "۱ بار دیگر";
  return "";
}

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

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 px-3 py-3 sm:px-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
        <p className="text-lg font-black tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function countLabel(enabled: boolean, pending: boolean, value: number | undefined) {
  if (!enabled) return "خاموش";
  if (pending) return "…";
  return formatFaNumber(value ?? 0);
}

function normalizeLinks(links: SocialLink[] | null | undefined): SocialLink[] {
  if (!Array.isArray(links)) return [];
  return links.slice(0, 5).map((row) => ({ name: row?.name ?? "", url: row?.url ?? "" }));
}

function formatApproxSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `حدود ${formatFaNumber(1)} کیلوبایت`;
  if (bytes < 1024 * 1024) return `حدود ${formatFaNumber(Math.round(bytes / 1024))} کیلوبایت`;
  const mb = bytes / (1024 * 1024);
  return `حدود ${formatFaNumber(mb, mb < 10 ? 1 : 0)} مگابایت`;
}

function exportFileName(label: string, id: number) {
  const clean = label.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${clean || `chat-${id}`}.zip`;
}

async function downloadChatExport(chatId: number, filename: string) {
  const token = useAuth.getState().accessToken;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/me/export?chat=${chatId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) {
      toast.error("دانلود خروجی گفتگو ممکن نشد");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("دانلود خروجی گفتگو ممکن نشد");
  }
}
