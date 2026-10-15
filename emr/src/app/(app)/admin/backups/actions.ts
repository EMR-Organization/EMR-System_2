"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/server/errors";
import { runBackup, runOffsiteUpload } from "@/server/services/backups";

export async function runBackupAction() {
  const result = await toActionResult(async () => {
    const { name } = await runBackup();
    return { name };
  });
  if (result.ok) revalidatePath("/admin/backups");
  return result;
}

export async function runOffsiteAction() {
  const result = await toActionResult(async () => {
    const results = await runOffsiteUpload();
    return {
      copied: results.filter((r) => r.status === "uploaded" || r.status === "alreadyThere").length,
      problems: results.filter((r) => r.status === "failed" || r.status === "damaged").length,
    };
  });
  revalidatePath("/admin/backups");
  return result;
}
