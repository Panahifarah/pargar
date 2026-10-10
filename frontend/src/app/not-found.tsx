import { NotFoundState } from "@/components/not-found-state";

export default function NotFound() {
  return (
    <NotFoundState
      title="صفحه پیدا نشد"
      description="این آدرس در سامانه نیست. از خانه می‌توانید دوباره شروع کنید."
      href="/"
      actionLabel="بازگشت به خانه"
    />
  );
}
