/**
 * Core value types.
 *
 * These mirror `@ricsam/formula-engine` so the components can be used with or
 * without the engine installed. The engine is an optional peer dependency; the
 * grid itself only ever needs to know that a cell holds a primitive.
 */
export type SerializedCellValue = string | number | boolean | undefined;

/** Column widths keyed by column letter, e.g. `{ A: 160 }`. */
export type SpreadsheetColumnWidths = Record<string, number>;

/** Row heights keyed by 1-based row number, e.g. `{ 1: 40 }`. */
export type SpreadsheetRowHeights = Record<number, number>;

/** Data passed to `customCellStyle` / `customCellRenderer`. */
export type CellRenderContext = {
  /** A1-style identifier, e.g. `"B7"`. */
  id: string;
  /** 1-based row number. */
  row: number;
  /** Column letter. */
  col: string;
  /** 0-based row index. */
  rowIndex: number;
  /** 0-based column index. */
  colIndex: number;
  value: SerializedCellValue;
  isSelected: boolean;
  isBeingEdited: boolean;
};

/**
 * @deprecated Use {@link CellRenderContext}. Kept as an alias for consumers
 * migrating from the original internal component.
 */
export type ConditionalStyleCallbackData = CellRenderContext;
