import { z } from "zod";
import { PASSWORD_MAX } from "../password-policy";

// Input shapes for the account forms. The server parses every input with these;
// the forms reuse them for instant feedback. Password strength rules are in
// password-policy.ts because they need the email too.

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "email" }));

// Only a length cap here; checkPassword() applies the real rules.
const password = z.string().min(1, { error: "required" }).max(PASSWORD_MAX * 4, { error: "tooLong" });

export const signInSchema = z.object({ email, password });

export const registerSchema = z.object({
  name: z.string().trim().min(2, { error: "required" }).max(100),
  email,
  password,
  role: z.enum(["DOCTOR", "STUDENT"], { error: "role" }),
});

export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword: password,
});

export const RESET_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const RESET_CODE_LENGTH = 8;

export const resetWithCodeSchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((c) => c.replace(/[\s-]/g, ""))
    .pipe(z.string().length(RESET_CODE_LENGTH, { error: "code" })),
  newPassword: password,
});

export type SignInInput = z.input<typeof signInSchema>;
export type RegisterInput = z.input<typeof registerSchema>;
