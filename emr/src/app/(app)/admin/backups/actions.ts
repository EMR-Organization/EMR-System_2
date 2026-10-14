"use server";

import { revalidatePath } from "next/cache";
import { toActionResult } from "@/server/errors";
import { runBackup } from "@/server/services/backups";

export async function runBackupAction() {
  const result = await toActionResult(async () => {
    const { name } = await runBackup();
    return { name };
  });
  if (result.ok) revalidatePath("/admin/backups");
  return result;
}
