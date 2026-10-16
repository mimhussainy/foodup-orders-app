// House-number handling for printed receipts (FoodUp Pro).
// The courier sees the full address only in the FoodUp Courier app after
// scanning the receipt's QR code.

// A house number as written in Switzerland/Germany: "12", "12a", "12 a",
// "12A", "12-14", "12/3", "12.1", "12a-c".
const HOUSE_NUMBER = String.raw`\d+\s?[a-zA-Z]?(?:\s?[-/.]\s?\d*\s?[a-zA-Z]?)*`;

const TRAILING_NUMBER = new RegExp(String.raw`[\s,]+${HOUSE_NUMBER}\s*$`);
const LEADING_NUMBER = new RegExp(String.raw`^\s*${HOUSE_NUMBER}[\s,]+(?=\D)`);
// Single line without commas: "Bahnhofstrasse 12 8302 Kloten".
const NUMBER_BEFORE_ZIP = new RegExp(String.raw`(\D)\s+${HOUSE_NUMBER}(?=\s+\d{4}\b)`);

/** "Bahnhofstrasse 12a" -> "Bahnhofstrasse"; "12 Bahnhofstrasse" -> "Bahnhofstrasse". */
export function stripHouseNumber(street: string): string {
  const value = String(street || '').trim();
  if (!value) return value;
  const withoutTrailing = value.replace(TRAILING_NUMBER, '').trim();
  const result = withoutTrailing.replace(LEADING_NUMBER, '').trim();
  // Never print an empty street (the line would only have been a number).
  return /[a-zA-ZäöüÄÖÜéèàç]/.test(result) ? result : '';
}

/** Address without commas: remove the house number, keep ZIP and city. */
export function stripHouseNumberFromSingleLine(address: string): string {
  const value = String(address || '').trim();
  if (!value) return value;
  if (NUMBER_BEFORE_ZIP.test(value)) return value.replace(NUMBER_BEFORE_ZIP, '$1').trim();
  return stripHouseNumber(value);
}
