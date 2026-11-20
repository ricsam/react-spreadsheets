import type { SelectionManager } from "@ricsam/selection-manager";
import type { SerializedCellValue } from "../types";
import { parseCellReference } from "../spreadsheet/utils";

export type CellDataUpdate = {
  rowIndex: number;
  colIndex: number;
  value: string;
};

export interface ExtractedCells {
  width: number;
  height: number;
  /** The selection's top-left cell. */
  origin: { rowIndex: number; columnIndex: number };
  /**
   * The sheet row of each relative row, in order. Hidden (filtered) rows are
   * left out, so this has `height` entries and may skip rows.
   */
  rows: number[];
  cells: {
    relative: { rowIndex: number; columnIndex: number };
    absolute: { rowIndex: number; columnIndex: number };
    value: SerializedCellValue;
    key: string;
  }[];
}

/**
 * Shared clipboard helpers for grid selections.
 *
 * Subclasses decide *what* is copied (raw values, formulas, styles) while this
 * base class owns the geometry of the selection and the TSV serialization that
 * external apps such as Excel and Google Sheets expect.
 */
export class ClipboardUtils {
  /**
   * Flattens the current selection into a rectangular block plus per-cell
   * coordinates relative to the top-left of that block. Rows the selection
   * manager reports as hidden are left out and the rows below move up, the way
   * copying a filtered range in Excel copies only what is shown.
   */
  extractCellsFromSelection(
    selectionManager: SelectionManager,
    cellData: Map<string, SerializedCellValue>,
  ): ExtractedCells | undefined {
    const state = selectionManager.getState();
    const selection = state.selections[state.selections.length - 1];
    if (!selection) return undefined;
    const isRowHidden = (row: number) => selectionManager.isRowHidden(row);

    // `end` edges are tagged unions and may be infinite. An infinite edge has
    // no meaningful clipboard extent, so clamp it to the furthest populated
    // cell instead of iterating forever.
    const finiteEndRow =
      selection.end.row.type === "number" ? selection.end.row.value : undefined;
    const finiteEndCol =
      selection.end.col.type === "number" ? selection.end.col.value : undefined;

    const startRow = Math.min(selection.start.row, finiteEndRow ?? selection.start.row);
    const startCol = Math.min(selection.start.col, finiteEndCol ?? selection.start.col);

    let endRow = startRow;
    let endCol = startCol;

    const cells: ExtractedCells["cells"] = [];

    cellData.forEach((value, key) => {
      let parsed: ReturnType<typeof parseCellReference>;
      try {
        parsed = parseCellReference(key);
      } catch {
        return;
      }

      const { rowIndex, columnIndex } = parsed;
      if (rowIndex < startRow || columnIndex < startCol) return;
      if (finiteEndRow !== undefined && rowIndex > finiteEndRow) return;
      if (finiteEndCol !== undefined && columnIndex > finiteEndCol) return;
      if (isRowHidden(rowIndex)) return;

      endRow = Math.max(endRow, rowIndex);
      endCol = Math.max(endCol, columnIndex);

      cells.push({
        relative: {
          rowIndex: rowIndex - startRow,
          columnIndex: columnIndex - startCol,
        },
        absolute: { rowIndex, columnIndex },
        value,
        key,
      });
    });

    if (finiteEndRow !== undefined) endRow = finiteEndRow;
    if (finiteEndCol !== undefined) endCol = finiteEndCol;

    const rows: number[] = [];
    if (selectionManager.getHiddenRows().size === 0) {
      for (let row = startRow; row <= endRow; row++) rows.push(row);
    } else {
      const relativeRow = new Map<number, number>();
      for (let row = startRow; row <= endRow; row++) {
        if (isRowHidden(row)) continue;
        relativeRow.set(row, rows.length);
        rows.push(row);
      }
      for (const cell of cells) {
        cell.relative.rowIndex = relativeRow.get(cell.absolute.rowIndex)!;
      }
    }

    return {
      width: endCol - startCol + 1,
      height: rows.length,
      origin: { rowIndex: startRow, columnIndex: startCol },
      rows,
      cells,
    };
  }

  createExportGrid(width: number, height: number): SerializedCellValue[][] {
    return Array.from({ length: Math.max(0, height) }, () =>
      Array.from<SerializedCellValue>({ length: Math.max(0, width) }).fill(""),
    );
  }

  /**
   * Serializes a grid into the TSV form used on the clipboard.
   *
   * Exposed separately from {@link writeToOsClipboard} so callers can compute a
   * signature for round-trip detection ("did this paste originate here?")
   * without touching the system clipboard.
   */
  getTsvString(grid: SerializedCellValue[][]): string {
    return grid
      .map((row) => row.map((cell) => (cell === undefined ? "" : String(cell))).join("\t"))
      .join("\n");
  }

  /**
   * Writes a TSV representation to the OS clipboard and returns the string so
   * callers can assert on it in tests or reuse it for an internal buffer.
   */
  writeToOsClipboard(grid: SerializedCellValue[][]): string {
    const text = this.getTsvString(grid);

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      void navigator.clipboard.writeText(text).catch(() => {
        // Clipboard permissions are environment-specific; failing to write
        // should never break the copy interaction itself.
      });
    }

    return text;
  }
}
