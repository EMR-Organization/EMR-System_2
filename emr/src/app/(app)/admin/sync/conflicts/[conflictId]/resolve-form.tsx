"use client";

import { useTranslations } from "next-intl";
import { FormError, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { resolveConflictAction } from "../../actions";

type Value = string | number | boolean | string[] | null;

export function ResolveForm({
  conflictId,
  hubVersion,
  node,
  fields,
}: {
  conflictId: string;
  hubVersion: number;
  node: string;
  fields: { field: string; hub: Value; incoming: Value }[];
}) {
  const t = useTranslations("Sync");
  // On success the action redirects to the Sync page, which says so.
  const [state, onSubmit, pending] = useServerForm(resolveConflictAction.bind(null, conflictId, hubVersion, fields.map((f) => f.field)));

  const show = (v: Value) => (v === null ? "—" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "boolean" ? (v ? t("yes") : t("no")) : String(v));
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      {fields.map(({ field, hub, incoming }) => (
        <fieldset key={field} className="grid gap-2 rounded-xl border p-3">
          <legend className="px-1 text-sm font-medium">{t(`fields.${field}`)}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={`choice:${field}`} value="hub" defaultChecked className="mt-1" />
            <span className="grid">
              <span className="text-xs text-muted-foreground">{t("keepHub")}</span>
              <span className="whitespace-pre-wrap break-words">{show(hub)}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={`choice:${field}`} value="incoming" className="mt-1" />
            <span className="grid">
              <span className="text-xs text-muted-foreground">{t("takeLaptop", { node })}</span>
              <span className="whitespace-pre-wrap break-words">{show(incoming)}</span>
            </span>
          </label>
        </fieldset>
      ))}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("saveChoices")}
      </Button>
    </form>
  );
}
