/**
 * Quotes a cell, and defuses spreadsheet formulas: a cell starting with = + - @
 * (or a tab/CR) gets a leading apostrophe, so opening the export in Excel can't
 * run anything a patient's name or address was made to contain.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}
