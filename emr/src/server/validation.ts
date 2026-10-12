import "server-only";
import type { z } from "zod";
import { ValidationError } from "@/server/errors";

/**
 * Parses service input with a Zod schema. Every service validates its input
 * this way, whatever the caller's TypeScript types claim, because server
 * actions can be called with any payload.
 * Error messages are message keys (see "Errors"/"Fields" in messages/en.json).
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError(fieldErrors);
  }
  return result.data;
}
