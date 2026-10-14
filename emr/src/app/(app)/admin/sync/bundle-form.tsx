"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Field, FormError, type FormState } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Summary = {
  dryRun: boolean;
  sourceNodeId: string;
  tripsCreated: string[];
  patientsAdded: number;
  renumbered: { from: string; to: string }[];
  recordsAdded: Record<string, number>;
  applied: number;
  conflicts: number;
  alreadyHere: number;
  auditAppended: number;
  skipped: string[];
};

/** "Check bundle" (a rolled-back dry run), then "Import". */
export function BundleForm() {
  const t = useTranslations("Sync");
  const router = useRouter();
  const feedback = useActionFeedback();
  const [state, setState] = useState<FormState>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [pending, startTransition] = useTransition();

  function send(dryRun: boolean) {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    data.set("dryRun", String(dryRun));
    startTransition(async () => {
      let result: FormState;
      try {
        const response = await fetch("/api/sync/import", { method: "POST", body: data });
        result = (await response.json()) as FormState;
      } catch {
        result = { ok: false, code: "INTERNAL", messageKey: "internal" };
      }
      setState(result);
      if (!result?.ok) return setPreview(null);
      setPreview(result.data as Summary);
      if (!dryRun) {
        feedback(result, t("imported"));
        router.refresh();
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(true);
  }

  const records = preview ? Object.values(preview.recordsAdded).reduce((a, b) => a + b, 0) : 0;
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      <Field
        name="file"
        label={t("file")}
        type="file"
        accept=".hfsync"
        required
        hint={t("fileHint")}
        onChange={(e) => {
          setFile(e.currentTarget.files?.[0] ?? null);
          setPreview(null);
          setState(null);
        }}
        state={state}
      />
      {preview && (
        <Alert role="status">
          <AlertDescription className="grid gap-1">
            <p className="font-medium">{preview.dryRun ? t("previewTitle", { node: preview.sourceNodeId }) : t("doneTitle", { node: preview.sourceNodeId })}</p>
            <p>{t("summaryPatients", { count: preview.patientsAdded })}</p>
            <p>{t("summaryRecords", { count: records, applied: preview.applied, here: preview.alreadyHere })}</p>
            <p>{t("summaryAudit", { count: preview.auditAppended })}</p>
            {preview.conflicts > 0 && <p className="font-medium">{t("summaryConflicts", { count: preview.conflicts })}</p>}
            {preview.tripsCreated.length > 0 && <p>{t("summaryTrips", { codes: preview.tripsCreated.join(", ") })}</p>}
            {preview.renumbered.length > 0 && (
              <p className="text-xs">
                {t("summaryNumbers")} {preview.renumbered.slice(0, 10).map((r) => `${r.from} → ${r.to}`).join(", ")}
                {preview.renumbered.length > 10 && "…"}
              </p>
            )}
            {preview.skipped.length > 0 && (
              <ul className="list-disc pl-5 text-xs">
                {preview.skipped.slice(0, 10).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={preview?.dryRun ? "outline" : "default"} disabled={pending || !file}>
          {pending ? t("working") : t("check")}
        </Button>
        {preview?.dryRun && (
          <Button type="button" disabled={pending} onClick={() => send(false)}>
            {t("confirm")}
          </Button>
        )}
      </div>
    </form>
  );
}
