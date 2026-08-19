import type { CellDataType, SerializedCellValue } from "@ricsam/formula-engine";

/**
 * Cell input coercion and display helpers.
 *
 * The grid always hands back raw strings from the editor. These helpers turn
 * that string into the value the engine should store, honouring an explicit
 * per-cell data type when one has been set.
 */

const TRUE_LITERALS = new Set(["true", "yes"]);
const FALSE_LITERALS = new Set(["false", "no"]);

/** Parses a numeric string, accepting `,` as a decimal separator. */
const parseNumeric = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Accept European-style decimals, but only when there is a single comma and
  // no dot, so thousands separators are not silently mangled.
  const normalized =
    trimmed.includes(",") && !trimmed.includes(".") && trimmed.split(",").length === 2
      ? trimmed.replace(",", ".")
      : trimmed;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Converts raw editor input into the value to store for a cell.
 *
 * - Formulas (leading `=`) are always preserved verbatim.
 * - `"general"` infers number/boolean, otherwise keeps the string.
 * - An explicit data type forces that interpretation, falling back to the raw
 *   string when the input cannot be represented.
 * - An empty string clears the cell (`undefined`).
 */
export function coerceCellInput(
  value: string,
  dataType: CellDataType = "general",
): SerializedCellValue {
  if (value === "") return undefined;

  // Never reinterpret a formula; the engine owns its parsing.
  if (value.startsWith("=")) return value;

  switch (dataType) {
    case "text":
      return value;

    case "number": {
      const parsed = parseNumeric(value);
      return parsed === undefined ? value : parsed;
    }

    case "boolean": {
      const lower = value.trim().toLowerCase();
      if (TRUE_LITERALS.has(lower)) return true;
      if (FALSE_LITERALS.has(lower)) return false;
      return value;
    }

    case "general":
    default: {
      const lower = value.trim().toLowerCase();
      if (TRUE_LITERALS.has(lower)) return true;
      if (FALSE_LITERALS.has(lower)) return false;

      const parsed = parseNumeric(value);
      // Only treat it as a number when the text round-trips, so values such as
      // "1abc" or a leading-zero code like "007" stay text.
      if (parsed !== undefined && String(parsed) === value.trim()) {
        return parsed;
      }

      return value;
    }
  }
}

/** Formats an evaluated value for display, with thousands separators. */
export function getCellDisplayText(value: SerializedCellValue): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 10,
    });
  }
  return String(value);
}

/** Serializes a value for the clipboard (unformatted, round-trippable). */
export function getCellDisplayValue(value: SerializedCellValue): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}
