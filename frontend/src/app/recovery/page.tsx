import { redirect } from "next/navigation";

/** Self-service password recovery is disabled for students. */
export default function RecoveryPage() {
  redirect("/login");
}
