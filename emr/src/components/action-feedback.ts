"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FormState } from "@/components/form";

/**
 * Shows a toast for a server action's result. A signed-out result sends the
 * user to the sign-in page (their session ended, e.g. after 30 minutes idle).
 * Returns whether it succeeded.
 */
export function useActionFeedback() {
  const t = useTranslations("Errors");
  const router = useRouter();
  const pathname = usePathname();
  return (result: FormState, successMessage?: string): boolean => {
    if (!result) return false;
    if (result.ok) {
      if (successMessage) toast.success(successMessage);
      return true;
    }
    if (result.code === "AUTH") {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return false;
    }
    const fieldKey = Object.values(result.fieldErrors ?? {}).flat()[0];
    const key = result.messageKey === "validation" && fieldKey ? fieldKey : result.messageKey;
    toast.error(t.has(key) ? t(key) : t("internal"));
    return false;
  };
}
