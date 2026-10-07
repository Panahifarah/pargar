import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  CalendarPlus,
  DatabaseBackup,
  FileVideo,
  GraduationCap,
  HelpCircle,
  Link2,
  Megaphone,
  Package,
  Phone,
  PhoneOff,
  Settings2,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";

export type AdminTabId =
  | "stats"
  | "learning"
  | "users"
  | "orders"
  | "registration"
  | "invites"
  | "whitelist"
  | "blacklist"
  | "curriculum"
  | "questions"
  | "videos"
  | "events"
  | "challenges"
  | "announce"
  | "chat-export"
  | "settings";

export type AdminNavItem = {
  id: AdminTabId;
  label: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    title: "نمای کلی",
    items: [
      {
        id: "stats",
        label: "نمای کلی",
        description: "آمار سریع سامانه و یادداشت‌های کاری ادمین.",
        icon: Activity,
        adminOnly: true,
      },
    ],
  },
  {
    title: "افراد",
    items: [
      {
        id: "learning",
        label: "پیشرفت یادگیری",
        description: "وضعیت پیشرفت، استریک و جزئیات مسیر هر هنرجو.",
        icon: GraduationCap,
      },
      {
        id: "users",
        label: "کاربران",
        description: "ساخت، ویرایش، قفل و مدیریت نقش حساب‌ها.",
        icon: Users,
        adminOnly: true,
      },
      {
        id: "orders",
        label: "سفارش فیزیکی",
        description: "پیگیری درخواست و ارسال گواهینامه فیزیکی.",
        icon: Package,
        adminOnly: true,
      },
    ],
  },
  {
    title: "ثبت‌نام و دسترسی",
    items: [
      {
        id: "registration",
        label: "ثبت‌نام عمومی",
        description: "روشن/خاموش کردن ثبت‌نام آزاد در /register و نمای کلی دسترسی.",
        icon: UserPlus,
        adminOnly: true,
      },
      {
        id: "invites",
        label: "لینک عضویت",
        description: "ساخت و مدیریت لینک‌های دعوت با ظرفیت و مهلت.",
        icon: Link2,
        adminOnly: true,
      },
      {
        id: "whitelist",
        label: "فهرست مجاز",
        description: "شماره‌هایی که وقتی اجبار فهرست مجاز روشن است اجازه ثبت‌نام عمومی دارند.",
        icon: Phone,
        adminOnly: true,
      },
      {
        id: "blacklist",
        label: "فهرست سیاه",
        description: "شماره‌هایی که همیشه رد می‌شوند — ثبت‌نام عمومی و دعوت‌نامه.",
        icon: PhoneOff,
        adminOnly: true,
      },
    ],
  },
  {
    title: "محتوای دوره",
    items: [
      {
        id: "curriculum",
        label: "دروس",
        description: "فصل‌ها، درس‌ها، ترتیب و درخت مهارت.",
        icon: BookOpen,
      },
      {
        id: "questions",
        label: "سوالات",
        description: "بانک سوالات چندگزینه‌ای هر درس.",
        icon: HelpCircle,
      },
      {
        id: "videos",
        label: "ویدیوها",
        description: "آپلود و مدیریت فایل‌های ویدیوی دروس.",
        icon: FileVideo,
      },
    ],
  },
  {
    title: "ارتباط",
    items: [
      {
        id: "events",
        label: "رویدادها",
        description: "کارگاه‌ها و جلسات قابل‌نمایش در مرکز هنرجو.",
        icon: CalendarPlus,
      },
      {
        id: "challenges",
        label: "چالش‌ها",
        description: "چالش ماهانه با هدف امتیاز برای هنرجویان.",
        icon: Trophy,
        adminOnly: true,
      },
      {
        id: "announce",
        label: "اطلاعیه",
        description: "ارسال اعلان گروهی به هنرجویان فعال.",
        icon: Megaphone,
        adminOnly: true,
      },
      {
        id: "chat-export",
        label: "آرشیو گفتگوها",
        description: "خروجی ساختاریافته و لینک دانلود موقت برای همه گفتگوهای پروژه.",
        icon: DatabaseBackup,
        adminOnly: true,
      },
    ],
  },
  {
    title: "سایت",
    items: [
      {
        id: "settings",
        label: "تنظیمات سایت",
        description: "حمایت مالی، گواهینامه فیزیکی و اسپانسرهای لندینگ.",
        icon: Settings2,
        adminOnly: true,
      },
    ],
  },
];

export function findAdminNavItem(id: AdminTabId): AdminNavItem | undefined {
  return ADMIN_NAV.flatMap((g) => g.items).find((i) => i.id === id);
}

export function defaultAdminTab(_isAdmin: boolean): AdminTabId {
  return "learning";
}

export function isValidAdminTab(id: string, isAdmin: boolean): id is AdminTabId {
  const item = findAdminNavItem(id as AdminTabId);
  if (!item) return false;
  if (item.adminOnly && !isAdmin) return false;
  return true;
}
