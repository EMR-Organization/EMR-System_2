/**
 * Patient labels keep the old app's format: a 3-digit per-trip number plus the
 * trip code, e.g. 001_05_2026. Numbers past 999 simply get longer (1000_05_2026).
 */
export function formatPatientLabel(displayNumber: number, tripCode: string): string {
  if (!Number.isInteger(displayNumber) || displayNumber < 1) {
    throw new RangeError(`Invalid patient number: ${displayNumber}`);
  }
  return `${String(displayNumber).padStart(3, "0")}_${tripCode}`;
}

const LABEL_RE = /^(\d{3,})_(\d{2}_\d{4}(?:_[A-Za-z0-9]+)?)$/;

/** Parses a label like 001_05_2026 (as typed in search, or from the old app's data). */
export function parsePatientLabel(label: string): { displayNumber: number; tripCode: string } | null {
  const match = LABEL_RE.exec(label.trim());
  if (!match) return null;
  const displayNumber = Number(match[1]);
  if (displayNumber < 1) return null;
  return { displayNumber, tripCode: match[2] };
}

/** The trip code for a month and year, e.g. (5, 2026) -> "05_2026". */
export function tripCodeFor(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}_${year}`;
}
