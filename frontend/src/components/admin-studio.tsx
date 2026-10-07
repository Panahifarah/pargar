"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Cpu,
  Eye,
  Flag,
  GitBranch,
  Globe,
  GripVertical,
  Heart,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  Timer,
  TriangleAlert,
  Trash2,
  Unlock,
  Video,
  Zap,
} from "lucide-react";
import { http, signedMediaUrl, toUserError } from "@/lib/api";
import type {
  AdminEvent,
  Chapter,
  Lesson,
  Role,
  User,
} from "@/lib/types";
import { useAuth } from "@/lib/auth-store";
import {
  clampPhoneInput,
  normalizePhone,
  PHONE_INPUT_MAX_LEN,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
  validateSecurityQA,
  validateUsername,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UserAvatar, avatarPropsOf } from "@/components/ui/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatFaNumber, formatStreakLabel } from "@/lib/utils";
import { toast } from "@/components/providers";
import {
  ADMIN_NAV,
  defaultAdminTab,
  findAdminNavItem,
  isValidAdminTab,
  type AdminTabId,
} from "@/components/admin/nav";
import { AdminPanelHeader } from "@/components/admin/panel-header";
import { useConfirm } from "@/components/admin/use-confirm";
import { StatsPanel } from "@/components/admin/stats-panel";
import { LearningPanel } from "@/components/admin/learning-panel";
import { QuestionsPanel } from "@/components/admin/questions-panel";
import { VideosPanel, VideoKeyPicker } from "@/components/admin/videos-panel";
import { AnnouncePanel } from "@/components/admin/announce-panel";
import { PhysicalOrdersPanel } from "@/components/admin/physical-orders-panel";
import {
  DEFAULT_PAGE_SIZE,
  ListPagination,
  buildPageQuery,
  type Paginated,
} from "@/components/admin/list-pagination";
import { AdminSelect, ListToolbar } from "@/components/admin/list-toolbar";
import { SiteSettingsPanel } from "@/components/admin/site-settings-panel";
import { RegistrationPanel } from "@/components/admin/registration-panel";
import { InvitesPanel } from "@/components/admin/invites-panel";
import { WhitelistPanel } from "@/components/admin/whitelist-panel";
import { BlacklistPanel } from "@/components/admin/blacklist-panel";
import { ChatExportPanel } from "@/components/admin/chat-export-panel";
import { ChallengesPanel } from "@/components/admin/challenges-panel";
import { JalaliDateTimePicker, isValidIsoRange } from "@/components/ui/jalali-datetime-picker";

const CHAPTER_ICON_OPTIONS: { key: string; icon: typeof Terminal; label: string }[] = [
  { key: "terminal", icon: Terminal, label: "ترمینال" },
  { key: "chip", icon: Cpu, label: "تراشه" },
  { key: "rocket", icon: Rocket, label: "موشک" },
  { key: "book", icon: BookOpen, label: "کتاب" },
  { key: "layers", icon: Layers, label: "لایه‌ها" },
  { key: "flag", icon: Flag, label: "پرچم" },
  { key: "target", icon: Target, label: "هدف" },
  { key: "zap", icon: Zap, label: "صاعقه" },
  { key: "code", icon: Code2, label: "کد" },
  { key: "globe", icon: Globe, label: "دنیا" },
];

function chapterIconOf(key: string) {
  return CHAPTER_ICON_OPTIONS.find((o) => o.key === key)?.icon ?? Layers;
}

async function openSignedMedia(key: string) {
  if (!key) return;
  try {
    const url = await signedMediaUrl(key);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    toast.error(toUserError(e, "باز کردن فایل ممکن نشد"));
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("در کلیپ‌بورد کپی شد");
  } catch {
    toast.error("کپی ممکن نشد");
  }
}

function formatDur(sec: number) {
  if (!sec || sec < 60) return `${sec || 0} ث`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}د ${s}ث` : `${m} دقیقه`;
}

const MENTOR_HINT =
  "وضعیت کلی یادگیری هنرجویان، دروس، سوالات، ویدیوها و رویدادهای آموزشی.";

export function AdminStudio() {
  const user = useAuth((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "mentor") {
      router.replace("/cap");
    }
  }, [user, router]);

  if (user && user.role !== "admin" && user.role !== "mentor") {
    return null;
  }

  const rawTab = searchParams.get("tab") ?? "";
  const tab: AdminTabId = isValidAdminTab(rawTab, !!isAdmin)
    ? rawTab
    : defaultAdminTab(!!isAdmin);

  const setTab = useCallback(
    (next: AdminTabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!isValidAdminTab(rawTab, !!isAdmin)) {
      setTab(defaultAdminTab(!!isAdmin));
    }
  }, [rawTab, isAdmin, setTab]);

  const navItem = findAdminNavItem(tab);
  const visibleGroups = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => !i.adminOnly || isAdmin),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-kicker">{isAdmin ? "استودیو ادمین" : "استودیو منتور"}</p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
            {isAdmin ? (
              <>
                پنل <span className="text-gradient-brand">مدیریت</span>
              </>
            ) : (
              <>
                پنل <span className="text-gradient-brand">منتور</span>
              </>
            )}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {isAdmin
              ? "افراد، ثبت‌نام، محتوای دوره، ارتباط و تنظیمات سایت — گروه‌بندی‌شده تا چیزی گم نشود."
              : MENTOR_HINT}
          </p>
        </div>
        <Badge variant="accent" className="gap-1 rounded-lg px-3 py-1.5">
          <ShieldCheck className="h-4 w-4" /> {isAdmin ? "ادمین" : "منتور"}
        </Badge>
      </div>

      {/* Mobile: horizontal grouped chips */}
      <nav className="lg:hidden" aria-label={isAdmin ? "بخش‌های مدیریت" : "بخش‌های منتور"}>
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {visibleGroups.map((group) => (
            <div key={group.title} className="flex shrink-0 flex-col gap-1.5">
              <p className="px-1 text-[10px] font-bold text-muted-foreground">{group.title}</p>
              <div className="flex gap-1.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition-colors",
                        active
                          ? "bg-primary text-primary-foreground shadow-offset-sm"
                          : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <aside className="hidden w-52 shrink-0 lg:sticky lg:top-24 lg:block">
          <nav
            className="space-y-3 rounded-xl border border-border bg-card p-2.5"
            aria-label={isAdmin ? "منوی مدیریت" : "منوی منتور"}
          >
            {visibleGroups.map((group) => (
              <div key={group.title}>
                <p className="mb-1 px-2 text-[11px] font-bold text-muted-foreground">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setTab(item.id)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-bold transition-colors",
                            active
                              ? "bg-primary text-primary-foreground shadow-offset-sm"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {navItem && (
            <AdminPanelHeader
              title={navItem.label}
              description={navItem.description}
              icon={navItem.icon}
            />
          )}
          {tab === "stats" && isAdmin && <StatsPanel />}
          {tab === "learning" && <LearningPanel />}
          {tab === "users" && isAdmin && <UsersPanel />}
          {tab === "orders" && isAdmin && <PhysicalOrdersPanel />}
          {tab === "registration" && isAdmin && <RegistrationPanel onNavigate={setTab} />}
          {tab === "invites" && isAdmin && <InvitesPanel />}
          {tab === "whitelist" && isAdmin && <WhitelistPanel />}
          {tab === "blacklist" && isAdmin && <BlacklistPanel />}
          {tab === "settings" && isAdmin && <SiteSettingsPanel onNavigate={setTab} />}
          {tab === "curriculum" && <CurriculumPanel />}
          {tab === "questions" && <QuestionsPanel />}
          {tab === "videos" && <VideosPanel />}
          {tab === "events" && <AdminEventsPanel />}
          {tab === "challenges" && isAdmin && <ChallengesPanel />}
          {tab === "announce" && isAdmin && <AnnouncePanel />}
          {tab === "chat-export" && isAdmin && <ChatExportPanel />}
        </div>
      </div>
    </div>
  );
}
function UsersPanel() {
  const qc = useQueryClient();
  const currentUser = useAuth((s) => s.user);
  const isStaff = currentUser?.role === "admin" || currentUser?.role === "mentor";
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<number | null>(null);
  const [dialogUser, setDialogUser] = useState<User | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    setPage(1);
  }, [q, roleFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", q, roleFilter, page],
    queryFn: () => {
      const params = new URLSearchParams(buildPageQuery(page));
      if (q) params.set("q", q);
      if (roleFilter) params.set("role", roleFilter);
      return http.get<Paginated<User>>(`/api/admin/users?${params.toString()}`);
    },
  });

  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? DEFAULT_PAGE_SIZE;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
  };

  const act = async (id: number, kind: "lock" | "unlock") => {
    setBusy(id);
    try {
      if (kind === "lock") await http.post(`/api/admin/users/${id}/lock`);
      else await http.post(`/api/admin/users/${id}/unlock`);
      invalidate();
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  const del = async (u: User) => {
    if (
      !(await confirm(
        "حذف کاربر",
        `حساب «${u.name}» (${u.email}) برای همیشه حذف شود؟ این عمل بازگشت‌ناپذیر است.`
      ))
    ) {
      return;
    }
    setBusy(u.id);
    try {
      await http.del(`/api/admin/users/${u.id}`);
      toast.success("کاربر حذف شد");
      invalidate();
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {dialog}
      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">فهرست حساب‌ها</CardTitle>
            {isStaff && (
              <Button size="sm" onClick={() => setDialogUser({ id: 0, email: "", username: "", name: "", role: "student", xp: 0, hearts: 3, heartsUpdatedAt: "", streakCurrent: 0, streakLongest: 0, isLocked: false, isActive: true, createdAt: "" })}>
                <Plus className="h-4 w-4" /> کاربر جدید
              </Button>
            )}
          </div>
          <ListToolbar className="border-0 pb-0">
            <Input
              placeholder="جستجو با نام، شناسه یا ایمیل…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            <AdminSelect
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">همه نقش‌ها</option>
              <option value="student">هنرجوها</option>
              {isStaff && <option value="mentor">منتورها</option>}
              {currentUser?.role === "admin" && <option value="admin">ادمین‌ها</option>}
            </AdminSelect>
            {(q || roleFilter) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setRoleFilter("");
                  setPage(1);
                }}
              >
                پاک کردن
              </Button>
            )}
          </ListToolbar>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="divide-y divide-border rounded-lg border border-border">
            {isLoading && (
              <div className="space-y-0 divide-y divide-border">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="p-3">
                    <LoaderRow />
                  </div>
                ))}
              </div>
            )}
            {(users).map((u) => {
              const canMutate =
                currentUser?.role === "admin" ||
                (currentUser?.role === "mentor" && u.role === "student");
              return (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                <UserAvatar name={u.name} className="h-9 w-9" {...avatarPropsOf(u)} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {u.name}
                    {u.id === currentUser?.id && <Badge variant="secondary" className="px-1.5 text-[10px]">شما</Badge>}
                    {u.isLocked && <Badge variant="destructive" className="px-1.5 text-[10px]">قفل شده</Badge>}
                    {u.role === "admin" && <Badge className="bg-primary/10 px-1.5 text-[10px] text-primary">ادمین</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    @{u.username} · {u.email}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                </div>
                <div className="hidden gap-3 text-xs text-muted-foreground sm:flex">
                  <span>{formatFaNumber(u.xp)} امتیاز</span>
                  <span>{formatStreakLabel(u.streakCurrent)}</span>
                  <span className={cn("inline-flex items-center gap-1", u.role === "student" && u.hearts <= 1 && "font-bold text-destructive")}>
                    <Heart className="h-3.5 w-3.5 fill-current" />{" "}
                    {u.role === "admin" || u.role === "mentor" ? "∞" : formatFaNumber(u.hearts)}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {canMutate && u.id !== currentUser?.id && (
                    u.isLocked ? (
                      <Button size="sm" variant="success" disabled={busy === u.id} onClick={() => act(u.id, "unlock")}>
                        {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />} فعال‌سازی
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" disabled={busy === u.id} onClick={() => act(u.id, "lock")}>
                        {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />} قفل
                      </Button>
                    )
                  )}
                  {canMutate && (
                    <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => setDialogUser(u)} title="ویرایش">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canMutate && u.id !== currentUser?.id && (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" disabled={busy === u.id} onClick={() => del(u)} title="حذف">
                      {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
            {users.length === 0 && !isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">کاربری یافت نشد.</p>
            )}
          </div>
          <div className="mt-3">
            <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
      <UserDialog user={dialogUser} onClose={() => setDialogUser(null)} onSaved={invalidate} />
    </>
  );
}

function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentUser = useAuth((s) => s.user);
  const isNew = !!user && user.id === 0;
  const [form, setForm] = useState<User>(user ?? ({} as User));
  const [password, setPassword] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [resetAnswer, setResetAnswer] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (user) {
      setForm(user);
      setPassword("");
      setSecurityAnswer("");
      setResetAnswer("");
      setResetPassword("");
    }
  }, [user]);

  const isSelf = !isNew && !!user && user.id === currentUser?.id;

  const save = async () => {
    if (!form) return;
    const nameErr = validateName(form.name ?? "");
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    const userErr = validateUsername(form.username ?? "");
    if (userErr) {
      toast.error(userErr);
      return;
    }
    const emailErr = validateEmail(form.email ?? "");
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    const phoneErr = validatePhone(form.phone ?? "", false);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }
    if (isSelf && form.role !== currentUser?.role) {
      toast.error("نمی‌توانید نقش حساب خودتان را تغییر دهید");
      return;
    }
    if (isNew) {
      const pwErr = validatePassword(password);
      if (pwErr) {
        toast.error(pwErr);
        return;
      }
      const secErr = validateSecurityQA(form.securityQuestion ?? "", securityAnswer);
      if (secErr) {
        toast.error(secErr);
        return;
      }
    } else if (securityAnswer.trim()) {
      const q = (form.securityQuestion ?? "").trim();
      if (q) {
        const secErr = validateSecurityQA(q, securityAnswer);
        if (secErr) {
          toast.error(secErr);
          return;
        }
      } else if ([...securityAnswer.trim()].length < 2) {
        toast.error("جواب امنیتی خیلی کوتاه است");
        return;
      }
    }
    setSaving(true);
    try {
      if (isNew) {
        await http.post("/api/admin/users", {
          name: (form.name ?? "").trim(),
          email: (form.email ?? "").trim().toLowerCase(),
          username: (form.username ?? "").trim().toLowerCase(),
          password,
          role: form.role,
          phone: normalizePhone(form.phone ?? ""),
          securityQuestion: (form.securityQuestion ?? "").trim(),
          securityAnswer: securityAnswer.trim(),
        });
        toast.success("کاربر ساخته شد");
      } else {
        await http.put(`/api/admin/users/${form.id}`, {
          name: (form.name ?? "").trim(),
          email: (form.email ?? "").trim().toLowerCase(),
          username: (form.username ?? "").trim().toLowerCase(),
          phone: normalizePhone(form.phone ?? ""),
          ...(form.securityQuestion?.trim()
            ? { securityQuestion: form.securityQuestion.trim() }
            : {}),
          ...(securityAnswer.trim() ? { securityAnswer: securityAnswer.trim() } : {}),
          ...(isSelf ? {} : { role: form.role, hearts: form.hearts, xp: form.xp }),
        });
        toast.success("کاربر به‌روزرسانی شد");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!form?.id) return;
    const pwErr = validatePassword(resetPassword);
    if (!resetAnswer.trim() || pwErr) {
      toast.error(pwErr ?? "جواب امنیتی و رمز جدید (حداقل ۸ کاراکتر) لازم است");
      return;
    }
    setResetting(true);
    try {
      await http.post(`/api/admin/users/${form.id}/reset-password`, {
        securityAnswer: resetAnswer,
        newPassword: resetPassword,
      });
      toast.success("رمز عبور ریست شد");
      setResetAnswer("");
      setResetPassword("");
    } catch (e) {
      toast.error(toUserError(e));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "کاربر جدید" : `ویرایش «${form.name}»`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "حساب جدید با تلفن و سوال امنیتی. رمز حداقل ۸ کاراکتر."
              : "اطلاعات کاربر را به‌روزرسانی کنید. ریست رمز فقط با جواب امنیتی."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>نام</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>شناسه</Label>
            <Input
              value={form.username ?? ""}
              onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
              dir="ltr"
              className="text-left"
              placeholder="مثلاً ahp"
            />
          </div>
          <div className="space-y-1.5">
            <Label>ایمیل</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>تلفن</Label>
            <Input
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: clampPhoneInput(e.target.value) })}
              dir="ltr"
              className="text-left"
              placeholder="09xxxxxxxxx"
              inputMode="tel"
              maxLength={PHONE_INPUT_MAX_LEN}
            />
          </div>
          <div className="space-y-1.5">
            <Label>نقش</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              value={form.role ?? "student"}
              disabled={isSelf}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="student">هنرجو</option>
              {currentUser?.role === "admin" && <option value="mentor">منتور</option>}
              {currentUser?.role === "admin" && <option value="admin">ادمین</option>}
            </select>
            {isSelf && (
              <p className="text-[11px] text-muted-foreground">نقش حساب خودتان قابل تغییر نیست.</p>
            )}
            {!isSelf && currentUser?.role === "mentor" && (
              <p className="text-[11px] text-muted-foreground">منتور فقط می‌تواند نقش هنرجو را تنظیم کند.</p>
            )}
          </div>
          {!isNew && !isSelf && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>قلب</Label>
                <Input
                  type="number"
                  min={0}
                  max={3}
                  value={form.hearts ?? 0}
                  onChange={(e) =>
                    setForm({ ...form, hearts: Math.max(0, Math.min(3, Number(e.target.value) || 0)) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>امتیاز (XP)</Label>
                <Input type="number" min={0} value={form.xp ?? 0} onChange={(e) => setForm({ ...form, xp: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>سوال امنیتی{!isNew && form.securityQuestion ? " (فعلی نمایش داده می‌شود)" : ""}</Label>
            <Input
              value={form.securityQuestion ?? ""}
              onChange={(e) => setForm({ ...form, securityQuestion: e.target.value })}
              placeholder="مثلاً نام اولین مدرسه؟"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{isNew ? "جواب امنیتی" : "جواب امنیتی جدید (خالی = بدون تغییر)"}</Label>
            <PasswordInput
              value={securityAnswer}
              onChange={(e) => setSecurityAnswer(e.target.value)}
              placeholder={isNew ? "الزامی" : "فقط در صورت تغییر"}
              dir="rtl"
              autoComplete="off"
            />
          </div>
          {isNew && (
            <div className="space-y-1.5">
              <Label>رمز</Label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="حداقل ۸ کاراکتر"
                required
                autoComplete="new-password"
              />
            </div>
          )}
          {!isNew && (
            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-medium">ریست رمز با سوال امنیتی</p>
              {form.securityQuestion ? (
                <p className="text-xs text-muted-foreground">سوال: {form.securityQuestion}</p>
              ) : (
                <p className="text-xs text-destructive">سوال امنیتی تعریف نشده است.</p>
              )}
              <PasswordInput
                value={resetAnswer}
                onChange={(e) => setResetAnswer(e.target.value)}
                placeholder="جواب امنیتی"
                dir="rtl"
                autoComplete="off"
              />
              <PasswordInput
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="رمز جدید (حداقل ۸ کاراکتر)"
                minLength={8}
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resetting || !form.hasSecurityAnswer}
                onClick={doReset}
              >
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                ریست رمز
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button onClick={save} disabled={saving || !(form.name ?? "").trim() || (isNew && password.length < 8)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isNew ? "ساخت" : "ذخیره"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CurriculumPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "lessons"],
    queryFn: async () => {
      const [c, l] = await Promise.all([
        http.get<{ chapters: Chapter[] }>("/api/admin/chapters"),
        http.get<{ lessons: Lesson[] }>("/api/admin/lessons"),
      ]);
      return { chapters: c.chapters, lessons: l.lessons };
    },
  });
  const chapters = [...(data?.chapters ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const lessons = (data?.lessons ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  const [lessonModal, setLessonModal] = useState<Lesson | null>(null);
  const [chapterModal, setChapterModal] = useState<Chapter | null>(null);
  const [dragIdx, setDragIdx] = useState<{ chapter: number; from: number; over?: number } | null>(null);

  const persistChapterOrder = async (list: Chapter[]) => {
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (ch.sortOrder !== i + 1) await http.put(`/api/admin/chapters/${ch.id}`, { ...ch, sortOrder: i + 1 });
    }
    qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
  };

  const persistLessonOrder = async (list: Lesson[]) => {
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.sortOrder !== i + 1) await http.put(`/api/admin/lessons/${l.id}`, { ...l, sortOrder: i + 1 });
    }
    qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
  };

  const moveChapter = async (idx: number, delta: number) => {
    const to = idx + delta;
    if (to < 0 || to >= chapters.length) return;
    const next = reorderArray(chapters, idx, to);
    try {
      await persistChapterOrder(next);
      toast.success("ترتیب فصل‌ها به‌روزرسانی شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const moveLesson = async (chapterId: number, idx: number, delta: number) => {
    const ls = lessons.filter((l) => l.chapterId === chapterId);
    const to = idx + delta;
    if (to < 0 || to >= ls.length) return;
    const next = reorderArray(ls, idx, to);
    try {
      await persistLessonOrder(next);
      toast.success("ترتیب درس‌ها به‌روزرسانی شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const saveChapter = async (ch: Chapter) => {
    try {
      if (ch.id) await http.put(`/api/admin/chapters/${ch.id}`, ch);
      else await http.post("/api/admin/chapters", { ...ch, sortOrder: chapters.length + 1, id: 0 });
      setChapterModal(null);
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
      toast.success(ch.id ? "فصل به‌روزرسانی شد" : "فصل ساخته شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const saveLesson = async (lv: Lesson) => {
    try {
      if (lv.id) await http.put(`/api/admin/lessons/${lv.id}`, lv);
      else await http.post("/api/admin/lessons", lv);
      setLessonModal(null);
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
      toast.success(lv.id ? "درس به‌روزرسانی شد" : "درس ساخته شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const newLesson = (chapterId: number) =>
    setLessonModal({
      id: 0, chapterId, title: "", description: "", videoKey: "",
      durationSeconds: 45, completionThresholdPct: 85, requiresLessonId: undefined,
      x: lessons.filter((l) => l.chapterId === chapterId).length, y: 0, sortOrder: 1, xpReward: 50, isActive: true,
    });

  const duplicateLesson = async (l: Lesson) => {
    try {
      await http.post("/api/admin/lessons", { ...l, id: 0, title: `${l.title} (کپی)`, sortOrder: 1 });
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
      toast.success("کپی درس ساخته شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const delLesson = async (l: Lesson) => {
    if (!(await confirm("حذف درس", `درس «${l.title}» (L${l.id}) با سوالاتش حذف شود؟`))) return;
    try {
      await http.del(`/api/admin/lessons/${l.id}`);
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.success("درس حذف شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const delChapter = async (ch: Chapter) => {
    if (
      !(await confirm(
        "حذف فصل",
        `فصل «${ch.title}» با همه درس‌هایش حذف شود؟ این عمل بازگشت‌ناپذیر است.`
      ))
    ) {
      return;
    }
    try {
      await http.del(`/api/admin/chapters/${ch.id}`);
      qc.invalidateQueries({ queryKey: ["admin", "lessons"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast.success("فصل حذف شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  return (
    <>
      {dialog}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">فصل‌ها و درخت مهارت</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {chapters.length} فصل · {lessons.length} درس · ترتیب با کشیدن یا فلش · موقعیت x,y
            </p>
          </div>
          <Button className="gap-1.5 rounded-2xl" onClick={() => setChapterModal({ id: 0, title: "", description: "", icon: "terminal", sortOrder: chapters.length + 1 })}>
            <Plus className="h-4 w-4" /> فصل جدید
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <Loader />}
          {chapters.map((ch, ci) => {
            const ls = lessons.filter((l) => l.chapterId === ch.id);
            const ChIcon = chapterIconOf(ch.icon);
            return (
              <div key={ch.id} className={cn("rounded-xl border border-border bg-muted/20", dragIdx !== null && dragIdx?.chapter === ch.id && "border-primary/50")}>
                <div className="flex items-center gap-2 p-3 pb-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ChIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold">{ch.title}</h3>
                    {ch.description && <p className="truncate text-xs text-muted-foreground">{ch.description}</p>}
                  </div>
                  <Badge variant="outline" className="shrink-0">{ls.length} درس</Badge>
                  <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                    {ls.filter((l) => l.videoKey).length}/{ls.length} ویدیو
                  </Badge>
                  <GroupNav
                    onUp={ci > 0 ? () => moveChapter(ci, -1) : undefined}
                    onDown={ci < chapters.length - 1 ? () => moveChapter(ci, 1) : undefined}
                  />
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setChapterModal(ch)}>
                    <Pencil className="h-3 w-3" /> فصل
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => newLesson(ch.id)}>
                    <Plus className="h-3.5 w-3.5" /> درس
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-destructive" onClick={() => delChapter(ch)} title="حذف فصل">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {ls.length === 0 ? (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">هنوز درسی نیست. «+ درس» را بزنید.</p>
                ) : (
                  <div className="px-3 pb-3">
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {ls.map((l, li) => {
                        const cols = ls.filter((o) => o.x === l.x && o.y === l.y && o.id !== l.id);
                        return (
                          <div
                            key={l.id}
                            draggable
                            onDragStart={() => setDragIdx({ chapter: ch.id, from: li })}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragIdx((d) => (d ? { ...d, over: li, chapter: ch.id } : d));
                            }}
                            onDrop={() => {
                              if (dragIdx && dragIdx.chapter === ch.id && dragIdx.from !== li) {
                                const idx = dragIdx.from;
                                const next = reorderArray(ls, idx, li);
                                persistLessonOrder(next).catch(() => {});
                              }
                              setDragIdx(null);
                            }}
                            onDragEnd={() => setDragIdx(null)}
                            className={cn(
                              "group flex cursor-grab items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors active:cursor-grabbing",
                              dragIdx?.from === li && dragIdx.chapter === ch.id && "opacity-40",
                              !l.videoKey && "border-dashed"
                            )}
                          >
                            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                            <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">L{l.id}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{l.title}</p>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Timer className="h-3 w-3" /> {formatDur(l.durationSeconds)}
                                <Sparkles className="h-3 w-3 text-gold" /> +{formatFaNumber(l.xpReward)}
                                <MapPin className="h-3 w-3" /> {l.x},{l.y}
                                {l.videoKey ? (
                                  <span className="inline-flex items-center gap-0.5 text-success"><Video className="h-3 w-3" /> ویدیو</span>
                                ) : (
                                  <span className="text-warning">بدون ویدیو</span>
                                )}
                                {cols.length > 0 && <Badge variant="destructive" className="px-1 text-[9px]">تداخل</Badge>}
                              </div>
                            </div>
                            <Badge variant={l.isActive ? "success" : "secondary"} className="px-1.5 text-[10px]">
                              {l.isActive ? "فعال" : "پیش‌نویس"}
                            </Badge>
                            <div className="flex shrink-0 gap-0.5">
                              <GroupNav onUp={li > 0 ? () => moveLesson(ch.id, li, -1) : undefined} onDown={li < ls.length - 1 ? () => moveLesson(ch.id, li, 1) : undefined} compact />
                              <Button size="sm" variant="ghost" className="h-7 px-1.5" title="تکثیر" onClick={() => duplicateLesson(l)}>
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setLessonModal(l)} title="ویرایش">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-destructive opacity-60 hover:opacity-100" onClick={() => delLesson(l)} title="حذف درس">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {chapters.length === 0 && !isLoading && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="font-bold">هنوز فصلی نیست</p>
              <p className="mt-1 text-sm text-muted-foreground">با «فصل جدید» شروع کنید؛ درس‌های هر فصل روی درخت مهارت هنرجو نمایش داده می‌شود.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <ChapterDialog chapter={chapterModal} onClose={() => setChapterModal(null)} onSave={saveChapter} />
      <LessonDialog
        lesson={lessonModal}
        chapters={chapters}
        lessons={lessons}
        onClose={() => setLessonModal(null)}
        onSave={saveLesson}
      />
    </>
  );
}

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function GroupNav({
  onUp,
  onDown,
  compact,
}: {
  onUp?: () => void;
  onDown?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex shrink-0 gap-0.5", compact ? "flex-col" : "flex-row")}>
      {onUp && (
        <Button size="sm" variant="ghost" className={cn("px-1 text-muted-foreground", compact ? "h-5" : "h-6")} onClick={onUp} title="بالا/جلو">
          <ChevronUp className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      )}
      {onDown && (
        <Button size="sm" variant="ghost" className={cn("px-1 text-muted-foreground", compact ? "h-5" : "h-6")} onClick={onDown} title="پایین/عقب">
          <ChevronDown className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        </Button>
      )}
    </div>
  );
}

function ChapterDialog({
  chapter,
  onClose,
  onSave,
}: {
  chapter: Chapter | null;
  onClose: () => void;
  onSave: (c: Chapter) => void;
}) {
  const isNew = !!chapter && chapter.id === 0;
  const [draft, setDraft] = useState<Chapter>(chapter ?? ({} as Chapter));
  useEffect(() => {
    if (chapter) setDraft(chapter);
  }, [chapter]);
  const ChIcon = chapterIconOf(draft.icon);

  return (
    <Dialog open={!!chapter} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "فصل جدید" : "ویرایش فصل"}</DialogTitle>
          <DialogDescription>فصل‌ها گروه‌های دروس درخت مهارت هستند و نمادشان روی نقشهٔ مسیر دیده می‌شود.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>عنوان</Label>
            <Input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>توضیحات (کوتاه)</Label>
            <Input value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="مثلاً مبانی ترمینال و گیت" />
          </div>
          <div className="space-y-1.5">
            <Label>نشان</Label>
            <div className="grid grid-cols-5 gap-2">
              {CHAPTER_ICON_OPTIONS.map((o) => {
                const active = (draft.icon ?? "") === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setDraft({ ...draft, icon: o.key })}
                    title={o.label}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors",
                      active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    <o.icon className="h-4 w-4" />
                    <span className="text-[9px] leading-none">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button disabled={!(draft.title ?? "").trim()} onClick={() => draft && onSave(draft)}>
            <Save className="h-4 w-4" /> {isNew ? "ساخت فصل" : "ذخیره فصل"}
          </Button>
        </DialogFooter>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ChIcon className="h-3.5 w-3.5" /> در نقشهٔ مسیر با این نشان نمایش داده می‌شود.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function LessonDialog({
  lesson,
  chapters,
  lessons,
  onClose,
  onSave,
}: {
  lesson: Lesson | null;
  chapters: Chapter[];
  lessons: Lesson[];
  onClose: () => void;
  onSave: (l: Lesson) => void;
}) {
  const [draft, setDraft] = useState<Lesson>(() => lesson ?? { id: 0, chapterId: 1, title: "", description: "", videoKey: "", durationSeconds: 90, completionThresholdPct: 85, requiresLessonId: undefined, x: 5, y: 3, sortOrder: 1, xpReward: 50, isActive: true });
  useEffect(() => {
    if (lesson) setDraft(lesson);
  }, [lesson]);
  const set = (patch: Partial<Lesson>) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = draft.id === 0;

  const others = lessons.filter((l) => l.id !== draft.id);
  const titleOk = draft.title.trim().length > 0;
  const durOk = draft.durationSeconds > 0;
  const thrOk = draft.completionThresholdPct >= 1 && draft.completionThresholdPct <= 100;
  const valid = titleOk && durOk && thrOk;

  const cycle = useMemo(() => {
    if (!draft.requiresLessonId) return false;
    let node: number | null = draft.requiresLessonId;
    const seen = new Set<number>();
    for (let i = 0; i < lessons.length + 1 && node; i++) {
      if (node === draft.id) return true;
      if (seen.has(node)) break;
      seen.add(node);
      node = lessons.find((l) => l.id === node)?.requiresLessonId ?? null;
    }
    return false;
  }, [draft.requiresLessonId, draft.id, lessons]);

  const collision = useMemo(
    () => lessons.some((l) => l.id !== draft.id && l.chapterId === draft.chapterId && l.x === draft.x && l.y === draft.y),
    [draft.chapterId, draft.id, draft.x, draft.y, lessons]
  );

  const prereq = lessons.find((l) => l.id === draft.requiresLessonId);
  const requiredSeconds = Math.round((draft.durationSeconds * draft.completionThresholdPct) / 100);

  return (
    <Dialog open={!!lesson} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-5 text-start">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {isNew ? "درس جدید" : `ویرایش درس L${draft.id}`}
            {!isNew && (
              <Switch checked={draft.isActive} onCheckedChange={(v) => set({ isActive: v })} aria-label="وضعیت درس" />
            )}
            <span className={cn("text-xs font-bold", draft.isActive ? "text-success" : "text-muted-foreground")}>
              {draft.isActive ? "فعال" : "پیش‌نویس"}
            </span>
          </DialogTitle>
          <DialogDescription>برای فعال شدن آزمون، هنرجو باید {thrOk ? formatDur(requiredSeconds) : "—"} تماشای تاییدشده داشته باشد.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-6 px-6 py-5">
            {/* محتوا */}
            <section className="space-y-3">
              <SectionTitle icon={<BookOpen className="h-3.5 w-3.5" />} text="محتوا" />
              <div className="space-y-1.5">
                <Label>عنوان درس</Label>
                <Input
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder="مثلاً HTTP در عمل"
                  className={cn(!titleOk && "border-destructive")}
                  autoFocus
                />
                <p className="text-right text-[11px] text-muted-foreground">{draft.title.length}/120 کاراکتر</p>
              </div>
              <div className="space-y-1.5">
                <Label>توضیحات</Label>
                <textarea
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={3}
                  placeholder="چرا این درس مهم است و چه چیزی می‌آموزد؟"
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <VideoKeyPicker value={draft.videoKey} onChange={(videoKey) => set({ videoKey })} />
                {draft.videoKey ? (
                  <button
                    type="button"
                    onClick={() => void openSignedMedia(draft.videoKey)}
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Video className="h-3.5 w-3.5" /> پیش‌نمایش ویدیو
                  </button>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <Video className="h-3.5 w-3.5" /> بدون ویدیو — اول از تب ویدیوها آپلود کنید
                  </p>
                )}
              </div>
            </section>

            {/* ساختار */}
            <section className="space-y-3">
              <SectionTitle icon={<GitBranch className="h-3.5 w-3.5" />} text="ساختار و گره‌های درخت" />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>فصل</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={draft.chapterId}
                    onChange={(e) => set({ chapterId: Number(e.target.value) })}
                  >
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>پیش‌نیاز (آزادکننده)</Label>
                  <select
                    className={cn(
                      "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                      cycle && "border-destructive"
                    )}
                    value={draft.requiresLessonId ? String(draft.requiresLessonId) : ""}
                    onChange={(e) => set({ requiresLessonId: e.target.value ? Number(e.target.value) : undefined })}
                  >
                    <option value="">بدون پیش‌نیاز (ریشه)</option>
                    {others.map((l) => (
                      <option key={l.id} value={l.id}>L{l.id} · {l.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              {cycle && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">
                  <TriangleAlert className="h-3.5 w-3.5" /> این پیش‌نیاز زنجیرهٔ چرخه‌ای می‌سازد و هرگز باز نمی‌شود.
                </p>
              )}
              {prereq && !cycle && (
                <p className="text-xs text-muted-foreground">
                  تنها پس از قبولی در «{prereq.title}» (L{prereq.id})، این درس برای هنرجو باز می‌شود.
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="x (ستون)" value={draft.x} onChange={(v) => set({ x: v })} />
                <NumberField label="y (ردیف)" value={draft.y} onChange={(v) => set({ y: v })} />
                <NumberField label="ترتیب" value={draft.sortOrder} onChange={(v) => set({ sortOrder: v })} />
              </div>
              {collision && (
                <p className="flex items-center gap-1.5 text-xs font-bold text-warning">
                  <MapPin className="h-3.5 w-3.5" /> جای {draft.x},{draft.y} همراستا با درس دیگری است — روی درخت روی هم می‌افتند.
                </p>
              )}
            </section>

            {/* امتیاز و آزمون */}
            <section className="space-y-3">
              <SectionTitle icon={<Sparkles className="h-3.5 w-3.5" />} text="امتیاز و آزمون" />
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="مدت (ثانیه)" value={draft.durationSeconds} onChange={(v) => set({ durationSeconds: v })} />
                <NumberField label="آستانه ٪" value={draft.completionThresholdPct} onChange={(v) => set({ completionThresholdPct: Math.min(100, Math.max(1, v)) })} />
                <NumberField label="پاداش XP" value={draft.xpReward} onChange={(v) => set({ xpReward: v })} />
              </div>
              {thrOk && (
                <p className="text-xs text-muted-foreground">
                  آزمون با {formatDur(requiredSeconds)} تماشای تأییدشده از میان {formatDur(draft.durationSeconds)} باز می‌شود؛ قبولیِ تک‌تک پرسش‌ها، شاخه‌های بعدی را آزاد می‌کند. روی هر پاسخ اشتباه یک جان کسر می‌شود.
                </p>
              )}
            </section>
          </div>

          {/* پیش‌نمایش زنده */}
          <aside className="border-t border-border bg-muted/30 px-6 py-5 md:border-s md:border-t-0">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
              <Eye className="h-3.5 w-3.5" /> پیش‌نمایش
            </p>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                {draft.isActive ? <Badge variant="success">فعال</Badge> : <Badge variant="secondary">پیش‌نویس</Badge>}
                {!isNew && <span className="text-[11px] font-bold text-muted-foreground">L{draft.id}</span>}
              </div>
              <p className="mt-2 text-sm font-black leading-snug">{draft.title || "عنوان درس"}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {draft.description || "توضیحاتی که کنجکاوی هنرجو را برمی‌انگیزد."}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
                <span className="rounded-full bg-muted px-2 py-0.5">▶ {formatDur(draft.durationSeconds)}</span>
                <span className="rounded-full bg-gold/10 px-2 py-0.5 text-gold">+{formatFaNumber(draft.xpReward)} امتیاز</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">آزمون {thrOk ? `${draft.completionThresholdPct}٪` : "؟"}</span>
              </div>
              {prereq && !cycle && (
                <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  🔓 پس از «{prereq.title}»
                </p>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
              <div className="rounded-lg bg-primary/10 px-1 py-2 text-primary">ux= {draft.x}</div>
              <div className="rounded-lg bg-accent/10 px-1 py-2 text-accent">uy= {draft.y}</div>
              <div className="rounded-lg bg-success/10 px-1 py-2 text-success">ترتیب {draft.sortOrder}</div>
            </div>
          </aside>
        </div>
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button variant="outline" className="h-10" onClick={onClose}>انصراف</Button>
          <Button className="h-10 gap-1.5" onClick={() => valid && onSave(draft)} disabled={!valid}>
            <Save className="h-4 w-4" /> {isNew ? "ساخت درس" : "ذخیره درس"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-muted-foreground">
      <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">{icon}</span>
      {text}
    </p>
  );
}
function AdminEventsPanel() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [modal, setModal] = useState<AdminEvent | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "events"],
    queryFn: () => http.get<{ events: AdminEvent[] }>("/api/admin/events"),
  });

  const save = async (ev: AdminEvent) => {
    if (!isValidIsoRange(ev.startsAt, ev.endsAt)) {
      toast.error("زمان پایان باید پس از زمان شروع باشد");
      return;
    }
    try {
      const { createdAt: _c, rsvped: _r, ...body } = ev;
      if (ev.id) await http.put(`/api/admin/events/${ev.id}`, body);
      else await http.post("/api/admin/events", body);
      setModal(null);
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      toast.success(ev.id ? "رویداد به‌روزرسانی شد" : "رویداد ساخته شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const del = async (ev: AdminEvent) => {
    if (!(await confirm("حذف رویداد", `رویداد «${ev.title}» حذف شود؟`))) return;
    try {
      await http.del(`/api/admin/events/${ev.id}`);
      qc.invalidateQueries({ queryKey: ["admin", "events"] });
      toast.success("رویداد حذف شد");
    } catch (e) {
      toast.error(toUserError(e));
    }
  };

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("fa-IR", { weekday: "short", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <>
      {dialog}
      <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base">فهرست رویدادها</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">در مرکز هنرجو نمایش داده می‌شوند.</p>
        </div>
        <Button className="gap-1.5" onClick={() => setModal({ id: 0, title: "", description: "", eventType: "workshop", externalUrl: "", startsAt: "", endsAt: "", rsvped: false, isActive: true, createdAt: "" })}>
          <Plus className="h-4 w-4" /> رویداد جدید
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && <Loader />}
        <div className="grid gap-3 sm:grid-cols-2">
          {(data?.events ?? []).map((e) => (
            <div key={e.id} className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2">
                <Badge variant="accent">{e.eventType === "workshop" ? "کارگاه" : e.eventType === "meet" ? "جلسه" : "آنلاین"}</Badge>
                <Badge variant={e.isActive ? "success" : "secondary"}>{e.isActive ? "فعال" : "پنهان"}</Badge>
                <div className="ms-auto flex gap-1">
                  {e.externalUrl && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="کپی لینک پیوستن" onClick={() => copyToClipboard(e.externalUrl)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setModal({ ...e })}>ویرایش</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => del(e)} title="حذف">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 font-medium">{e.title}</p>
              <p className="line-clamp-1 text-xs text-muted-foreground">{e.description || "—"}</p>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Timer className="h-3.5 w-3.5" /> {fmt(e.startsAt)} تا {new Date(e.endsAt).toLocaleTimeString("fa-IR")}
              </p>
            </div>
          ))}
        </div>
        {(data?.events ?? []).length === 0 && !isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">هنوز رویدادی نیست.</p>
        )}
      </CardContent>
      <EventDialog event={modal} onClose={() => setModal(null)} onSave={save} />
    </Card>
    </>
  );
}

function EventDialog({ event, onClose, onSave }: { event: AdminEvent | null; onClose: () => void; onSave: (e: AdminEvent) => void }) {
  const [draft, setDraft] = useState<AdminEvent | null>(event);
  useEffect(() => setDraft(event), [event]);
  const set = (patch: Partial<AdminEvent>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const valid =
    !!draft?.title.trim() &&
    !!draft?.startsAt &&
    !!draft?.endsAt &&
    isValidIsoRange(draft.startsAt, draft.endsAt);

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{draft?.id ? "ویرایش رویداد" : "رویداد جدید"}</DialogTitle>
          <DialogDescription>زمان‌ها با تقویم جلالی انتخاب می‌شوند و در مرکز هنرجو نمایش داده می‌شوند.</DialogDescription>
        </DialogHeader>
        {draft && (
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>عنوان</Label>
              <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="مثلاً کارگاه Git و گیت‌هاب" />
            </div>
            <div className="space-y-1.5">
              <Label>توضیحات</Label>
              <textarea
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={3}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="شرح کوتاه رویداد (اختیاری)…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نوع</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.eventType} onChange={(e) => set({ eventType: e.target.value as AdminEvent["eventType"] })}>
                  <option value="workshop">کارگاه</option>
                  <option value="meet">دیدار</option>
                  <option value="zoom">آنلاین</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>لینک پیوستن</Label>
                <Input dir="ltr" value={draft.externalUrl} onChange={(e) => set({ externalUrl: e.target.value })} placeholder="https://…" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>شروع (جلالی)</Label>
                <JalaliDateTimePicker value={draft.startsAt} onChange={(iso) => set({ startsAt: iso })} aria-label="زمان شروع جلالی" />
              </div>
              <div className="space-y-1.5">
                <Label>پایان (جلالی)</Label>
                <JalaliDateTimePicker value={draft.endsAt} onChange={(iso) => set({ endsAt: iso })} aria-label="زمان پایان جلالی" />
              </div>
            </div>
            {draft.startsAt && draft.endsAt && !isValidIsoRange(draft.startsAt, draft.endsAt) && (
              <p className="text-xs text-destructive">زمان پایان باید پس از زمان شروع باشد.</p>
            )}
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">فعال / قابل نمایش</p>
                <p className="text-[11px] text-muted-foreground">رویدادهای پنهان از پیشنهادات کنار می‌روند</p>
              </div>
              <Switch checked={draft.isActive} onCheckedChange={(v) => set({ isActive: v })} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>انصراف</Button>
          <Button disabled={!valid} onClick={() => draft && onSave(draft)}>ذخیره رویداد</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function Loader({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

function LoaderRow() {
  return (
    <div className="flex items-center gap-3 py-1">
      <Skeleton className="h-9 w-9 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-8 w-24 rounded-lg" />
    </div>
  );
}