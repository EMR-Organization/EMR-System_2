"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormError, useServerForm } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyChainAction } from "./actions";

export type CheckpointOption = { label: string; id: string; hash: string };

type ChainResult = { ok: true; checked: number } | { ok: false; checked: number; brokenAtId: string; reason: "hash" | "link" | "checkpoint" };

/** Verify chain, optionally against a checkpoint from a backup or typed in from a printout. */
export function VerifyForm({ checkpoints }: { checkpoints: CheckpointOption[] }) {
  const t = useTranslations("Audit");
  const [state, onSubmit, pending] = useServerForm(verifyChainAction);
  const [checkpoint, setCheckpoint] = useState({ id: "", hash: "" });
  const result = state?.ok ? (state.data as ChainResult) : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      {result && (
        <Alert variant={result.ok ? "default" : "destructive"} role="status">
          <AlertDescription>
            {result.ok
              ? t("chainOk", { count: result.checked })
              : t(`chainBroken.${result.reason}`, { id: result.brokenAtId, count: result.checked })}
          </AlertDescription>
        </Alert>
      )}
      {checkpoints.length > 0 && (
        <div className="grid gap-1.5">
          <label htmlFor="checkpoint-pick" className="text-sm font-medium">
            {t("fromBackup")}
          </label>
          <select
            id="checkpoint-pick"
            className="h-8 rounded-lg border bg-background px-2 text-sm"
            defaultValue=""
            onChange={(e) => setCheckpoint(checkpoints.find((c) => c.id === e.target.value) ?? { id: "", hash: "" })}
          >
            <option value="">{t("noCheckpoint")}</option>
            {checkpoints.map((c) => (
              <option key={`${c.id}-${c.label}`} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field
          name="checkpointId"
          label={t("checkpointId")}
          inputMode="numeric"
          value={checkpoint.id}
          onChange={(e) => setCheckpoint({ ...checkpoint, id: e.target.value })}
          state={state}
        />
        <Field
          name="checkpointHash"
          label={t("checkpointHash")}
          value={checkpoint.hash}
          onChange={(e) => setCheckpoint({ ...checkpoint, hash: e.target.value })}
          className="font-mono text-xs"
          state={state}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("checkpointHint")}</p>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? t("verifying") : t("verify")}
      </Button>
    </form>
  );
}
