// Password rules, shared so the register form can show problems as you type.
// The server always re-checks with the same function.
//
// Rules: 12-128 characters, not a well-known password, not just a common word
// plus digits/symbols, not mostly one repeated character, and not containing
// the email's name part. Length matters far more than symbols, so there are no
// "must include a digit" rules (NIST SP 800-63B).

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export type PasswordProblem = "tooShort" | "tooLong" | "common" | "containsEmail" | "tooSimple";

// Words people build weak passwords around. Compared after removing digits and symbols.
const COMMON_WORDS = new Set([
  "password", "passw", "passwd", "pass", "qwerty", "qwertyuiop", "asdf", "asdfgh", "asdfghjkl", "zxcvbnm",
  "qazwsx", "letmein", "welcome", "admin", "administrator", "iloveyou", "monkey", "dragon", "football",
  "baseball", "soccer", "sunshine", "princess", "master", "shadow", "superman", "batman", "trustno", "hello",
  "freedom", "whatever", "starwars", "secret", "login", "abc", "abcdef", "abcdefgh", "changeme", "default",
  "test", "guest", "user", "computer", "internet", "michael", "jennifer", "charlie", "jesus", "god", "love",
  "summer", "winter", "spring", "autumn", "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december", "humanity", "humanityfirst", "hfso", "hfusa",
  "emr", "doctor", "nurse", "student", "medical", "medicine", "hospital", "clinic", "patient", "health",
  "guatemala", "mission", "volunteer",
]);

// Well-known passwords of 12+ characters (shorter ones already fail the length rule).
const COMMON_PASSWORDS = new Set([
  "123456789012", "1234567890123", "12345678901234", "123456123456", "123123123123", "111111111111",
  "000000000000", "121212121212", "1q2w3e4r5t6y", "1qaz2wsx3edc", "qwertyuiop12", "qwertyuiopas",
  "qwerty123456", "qwertyqwerty", "asdfghjkl123", "zaq12wsxcde3", "zxcvbnm12345", "password1234",
  "password12345", "password123!", "passwordpassword", "iloveyou1234", "letmein12345", "welcome12345",
  "abcdefghijkl", "abc123abc123", "trustno1trustno1", "1234qwerasdf", "qwer1234asdf",
]);

export function checkPassword(password: string, email = ""): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  // Count characters, not UTF-16 units, so emoji and accents count once.
  const length = [...password].length;
  if (length < PASSWORD_MIN) problems.push("tooShort");
  if (length > PASSWORD_MAX) problems.push("tooLong");

  const lower = password.toLowerCase();
  const lettersOnly = lower.replace(/[^\p{L}]/gu, "");
  if (COMMON_PASSWORDS.has(lower) || COMMON_WORDS.has(lettersOnly) || isRepeatedWord(lettersOnly)) {
    problems.push("common");
  }

  const name = email.split("@")[0]?.toLowerCase() ?? "";
  const nameParts = [name, ...name.split(/[._+-]/)].filter((part) => part.length >= 3);
  if (nameParts.some((part) => lower.includes(part))) problems.push("containsEmail");

  if (new Set(lower).size < 5) problems.push("tooSimple");

  return problems;
}

// "passwordpassword", "qwertyqwerty"...
function isRepeatedWord(letters: string): boolean {
  for (const word of COMMON_WORDS) {
    if (word.length >= 3 && letters.length > word.length && letters === word.repeat(letters.length / word.length)) {
      return true;
    }
  }
  return false;
}
