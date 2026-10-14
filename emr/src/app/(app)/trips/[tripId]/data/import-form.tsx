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
  patientsAdded: number;
  patientsAlreadyHere: number;
  renumbered: { from: string; to: string }[];
  recordsAdded: Record<"conditions" | "vitals" | "diabetic" | "visits" | "medications", number>;
  recordsAlreadyHere: number;
  skipped: string[];
};

/**
 * Two steps: "Check file" runs the import as a dry run (rolled back) and shows
 * what it would do; "Import" then does it for real with the same file.
 */
export function ImportForm({ tripId }: { tripId: string }) {
  const t = useTranslations("Data");
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
        const response = await fetch(`/api/trips/${tripId}/import`, { method: "POST", body: data });
        result = (await response.json()) as FormState;
      } catch {
        result = { ok: false, code: "INTERNAL", messageKey: "internal" };
      }
      setState(result);
      if (!result?.ok) return setPreview(null);
      const summary = result.data as Summary;
      if (dryRun) setPreview(summary);
      else {
        feedback(result, t("imported", { count: summary.patientsAdded }));
        setPreview(summary);
        router.refresh();
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(true);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      <Field
        name="file"
        label={t("file")}
        type="file"
        accept="application/json,.json"
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
            <p className="font-medium">{preview.dryRun ? t("previewTitle") : t("doneTitle")}</p>
            <p>{t("summaryPatients", { added: preview.patientsAdded, here: preview.patientsAlreadyHere })}</p>
            <p>
              {t("summaryRecords", {
                added: Object.values(preview.recordsAdded).reduce((a, b) => a + b, 0),
                here: preview.recordsAlreadyHere,
              })}
            </p>
            {preview.renumbered.length > 0 && (
              <p>
                {t("summaryRenumbered", { count: preview.renumbered.length })}{" "}
                {preview.renumbered.slice(0, 10).map((r) => `${r.from} → ${r.to}`).join(", ")}
                {preview.renumbered.length > 10 && "…"}
              </p>
            )}
            {preview.skipped.length > 0 && (
              <div>
                <p>{t("summarySkipped", { count: preview.skipped.length })}</p>
                <ul className="list-disc pl-5 text-xs">
                  {preview.skipped.slice(0, 10).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={preview?.dryRun ? "outline" : "default"} disabled={pending || !file}>
          {pending ? t("checking") : t("check")}
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
