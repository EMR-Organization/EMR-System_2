import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

// Every language file must have exactly the English keys, and each message the
// same placeholders ({name}, {count, plural, …}): a missing key shows a raw key
// on screen, and a wrong placeholder throws when the page renders.

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v]] : Object.entries(flatten(v, `${prefix}${k}.`)))),
  );
}

/** "name:argument", "count:plural" … for every placeholder in a message, sorted. */
function placeholders(message: string): string[] {
  const found = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) found.add(`${el.value}:${TYPE[el.type]}`);
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        found.add(`${el.value}:${TYPE[el.type]}`);
        for (const option of Object.values(el.options)) walk(option.value);
      }
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message));
  return [...found].sort();
}

const english = flatten(en as Tree);

describe.each([["es", es]])("messages/%s.json", (_, messages) => {
  const translated = flatten(messages as Tree);

  it("has exactly the English keys", () => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
  });

  it("uses the same placeholders in every message", () => {
    const mismatches = Object.keys(english)
      .filter((key) => key in translated)
      .filter((key) => JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(translated[key])))
      .map((key) => `${key}: ${placeholders(english[key]).join(",")} vs ${placeholders(translated[key]).join(",")}`);
    expect(mismatches).toEqual([]);
  });
});
