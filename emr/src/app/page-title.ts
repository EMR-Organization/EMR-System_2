import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * A page's browser-tab title from its messages, e.g. "Vitals · Humanity First
 * EMR" (the root layout adds the suffix). Never a patient's name: tab titles
 * show up in browser history and app switchers.
 */
export function titled(namespace: string, key = "title") {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations(namespace);
    return { title: t(key) };
  };
}
