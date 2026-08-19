/**
 * @ricsam/react-spreadsheets
 *
 * React spreadsheet primitives: an infinitely scrollable, virtualized grid with
 * selection, editing, clipboard, fill handles, column/row resizing and floating
 * overlays — plus optional bindings for `@ricsam/formula-engine`.
 *
 * Remember to import the stylesheet once in your app:
 *   import "@ricsam/react-spreadsheets/styles.css";
 */

// Grid
export {
  Spreadsheet,
  type SpreadsheetProps,
  type SpreadsheetRef,
  type SpreadsheetChild,
  type SpreadsheetChildInitial,
  type SpreadsheetChildState,
  type SpreadsheetComponent,
} from "./spreadsheet/spreadsheet";

// Formula-engine bindings (require `@ricsam/formula-engine` at runtime)
export {
  FormulaSheet,
  FormulaWorkbook,
  WorkbookClipboardManager,
  WorkbookSelectionManager,
} from "./workbook/workbook";

export {
  coerceCellInput,
  getCellDisplayText,
  getCellDisplayValue,
} from "./workbook/cell-data-type";

export {
  normalizeBorderSides,
  hasAnyBorderSide,
  type BorderSides,
  type NormalizedBorderSides,
} from "./workbook/border-sides";

export {
  onCellEditError,
  queueCellEditError,
  type CellEditErrorListener,
} from "./workbook/cell-edit-error";

// Shared value + rendering types
export type {
  SerializedCellValue,
  SpreadsheetColumnWidths,
  SpreadsheetRowHeights,
  CellRenderContext,
  ConditionalStyleCallbackData,
} from "./types";

// A1 address helpers
export {
  columnToIndex,
  indexToColumn,
  getRowNumber,
  getCellReference,
  parseCellReference,
  rowToLetter,
  letterToRow,
  findCell,
  extractColumn,
  extractColumnByHeader,
} from "./spreadsheet/utils";

// Layout constants
export {
  DEFAULT_CELL_WIDTH,
  DEFAULT_CELL_HEIGHT,
  HEADER_WIDTH,
  HEADER_HEIGHT,
} from "./spreadsheet/constants";

export {
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_FACTOR,
  CONTROLLED_ZOOM_FACTOR,
} from "./spreadsheet/zoom-constants";

// Cell snapping utilities for overlay positioning
export {
  normalizeCellSnapAnchor,
  getCellSnapAnchorFromRect,
  getRectFromCellSnapAnchor,
  moveCellSnapAnchorToNearestOrigin,
  resizeCellSnapAnchorToNearestEdges,
  getColumnEdgePosition,
  getRowEdgePosition,
  getNearestColumnEdgeIndex,
  getNearestRowEdgeIndex,
  type CellSnapAnchor,
  type CellSnapRect,
  type CellSnapResizeHandle,
} from "./spreadsheet/snapping";

// Clipboard
export {
  ClipboardUtils,
  type CellDataUpdate,
  type ExtractedCells,
} from "./clipboard/clipboard-manager";

// Utilities
export { cn } from "./utils/cn";
export { useResizeObserver } from "./utils/use-resize-observer";
export { useColorScheme, type ColorScheme } from "./utils/use-color-scheme";
export { useClickAway } from "./utils/use-click-away";

// Overlay frame + viewport types
export { ViewportStream, type ViewportState, type ResizeHandle } from "./grid/types";
