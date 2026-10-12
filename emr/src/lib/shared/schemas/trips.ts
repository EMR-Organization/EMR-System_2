import { z } from "zod";

export const createTripSchema = z.object({
  name: z.string().trim().min(3, { error: "required" }).max(100),
  location: z.string().trim().min(2, { error: "required" }).max(100),
  month: z.coerce.number().int().min(1, { error: "month" }).max(12, { error: "month" }),
  year: z.coerce.number().int().min(2000, { error: "year" }).max(2100, { error: "year" }),
  /** Optional suffix when two trips share a month, e.g. "B" -> 05_2026_B. */
  suffix: z
    .string()
    .trim()
    .max(8)
    .regex(/^[A-Za-z0-9]*$/, { error: "suffix" })
    .optional()
    .transform((s) => (s ? s.toUpperCase() : undefined)),
});

export type CreateTripInput = z.input<typeof createTripSchema>;
