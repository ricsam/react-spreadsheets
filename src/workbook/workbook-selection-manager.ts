import type { RangeAddress, SpreadsheetRange, SpreadsheetRangeEnd } from '@ricsam/formula-engine';
import { indexToColumn, getCellReference } from '@ricsam/formula-engine';
import type {
  SelectionManager,
  SMArea,
  ViewportAlignment
} from '@ricsam/selection-manager';

interface ManagerContext {
  workbookName: string;
  sheetName: string;
}

export interface WorkbookRangeFocusOptions {
  /** How the target range should be positioned in the spreadsheet viewport. */
  align?: ViewportAlignment;
}

interface PendingRangeFocus {
  address: RangeAddress;
  options: WorkbookRangeFocusOptions;
}

export class WorkbookSelectionManager {
  private managers = new Map<SelectionManager, ManagerContext>();
  private lastFocusedManager: { sm: SelectionManager; context: ManagerContext } | null = null;
  private listeners = new Set<(selections: RangeAddress[]) => void>();
  private cleanupFunctions = new Map<SelectionManager, () => void>();
  private pendingRangeFocus: PendingRangeFocus | null = null;

  private smAreaToSpreadsheetRange(area: SMArea): SpreadsheetRange {
    const rowEnd: SpreadsheetRangeEnd =
      area.end.row.type === 'infinity'
        ? { type: 'infinity', sign: 'positive' }
        : { type: 'number', value: area.end.row.value };

    const colEnd: SpreadsheetRangeEnd =
      area.end.col.type === 'infinity'
        ? { type: 'infinity', sign: 'positive' }
        : { type: 'number', value: area.end.col.value };

    return {
      start: {
        col: area.start.col,
        row: area.start.row
      },
      end: {
        row: rowEnd,
        col: colEnd
      }
    };
  }

  private spreadsheetRangeToSmArea(range: SpreadsheetRange): SMArea {
    return {
      start: { row: range.start.row, col: range.start.col },
      end: {
        row:
          range.end.row.type === 'infinity'
            ? { type: 'infinity' }
            : { type: 'number', value: range.end.row.value },
        col:
          range.end.col.type === 'infinity'
            ? { type: 'infinity' }
            : { type: 'number', value: range.end.col.value }
      }
    };
  }

  private cloneRangeAddress(address: RangeAddress): RangeAddress {
    return {
      workbookName: address.workbookName,
      sheetName: address.sheetName,
      range: this.smAreaToSpreadsheetRange(this.spreadsheetRangeToSmArea(address.range))
    };
  }

  private matchesContext(address: RangeAddress, context: ManagerContext): boolean {
    return address.workbookName === context.workbookName && address.sheetName === context.sheetName;
  }

  private applyRangeFocus(
    manager: SelectionManager,
    context: ManagerContext,
    request: PendingRangeFocus
  ): void {
    const selection = this.spreadsheetRangeToSmArea(request.address.range);
    manager.setState({ selections: [selection] });
    manager.focus();
    manager.revealRange(selection, request.options);
    this.lastFocusedManager = { sm: manager, context };
    this.emitChange();
  }

  private applyPendingRangeFocusOnMount(
    manager: SelectionManager,
    context: ManagerContext
  ): void {
    const pending = this.pendingRangeFocus;
    if (!pending || !this.matchesContext(pending.address, context)) return;

    // Spreadsheet registers its consumer of SelectionManager viewport requests
    // in a later effect than FormulaSheet registers with this manager. Defer
    // until that listener exists so a queued reveal cannot be lost on mount.
    queueMicrotask(() => {
      if (this.pendingRangeFocus !== pending) return;
      const mountedContext = this.managers.get(manager);
      if (!mountedContext || !this.matchesContext(pending.address, mountedContext)) return;

      this.pendingRangeFocus = null;
      this.applyRangeFocus(manager, mountedContext, pending);
    });
  }

  /**
   * Register a SelectionManager with its workbook/sheet context
   * Returns a cleanup function to unregister
   */
  add(manager: SelectionManager, context: ManagerContext): () => void {
    this.managers.set(manager, context);

    // Listen to focus changes
    const focusCleanup = manager.observeStateChange(
      (state) => state.hasFocus,
      (hasFocus) => {
        if (hasFocus) {
          this.lastFocusedManager = { sm: manager, context };
          this.emitChange();
        }
      }
    );

    // Listen to selection changes
    const selectionCleanup = manager.observeStateChange(
      (state) => JSON.stringify(state.selections),
      (selectionsJson) => {
        const selections = JSON.parse(selectionsJson);
        if (selections && selections.length > 0) {
          this.lastFocusedManager = { sm: manager, context };
          this.emitChange();
        }
      }
    );

    // Store combined cleanup function
    const cleanup = () => {
      focusCleanup();
      selectionCleanup();
      this.managers.delete(manager);
      this.cleanupFunctions.delete(manager);
      if (this.lastFocusedManager?.sm === manager) {
        this.lastFocusedManager = null;
      }
    };

    this.cleanupFunctions.set(manager, cleanup);
    this.applyPendingRangeFocusOnMount(manager, context);
    return cleanup;
  }

  /**
   * Get the SelectionManager that was last focused or had selection activity
   */
  getLastFocusedSelectionManager(): { sm: SelectionManager; context: ManagerContext } | null {
    return this.lastFocusedManager;
  }

  /**
   * Get all current selections from the last focused manager.
   */
  getSelections(): RangeAddress[] {
    if (!this.lastFocusedManager) {
      return [];
    }

    const { sm, context } = this.lastFocusedManager;
    const state = sm.getState();

    return state.selections.map((area) => ({
      workbookName: context.workbookName,
      sheetName: context.sheetName,
      range: this.smAreaToSpreadsheetRange(area)
    }));
  }

  /**
   * Get the last/primary selection from the last focused manager
   */
  getLastSelection(): RangeAddress | null {
    const selections = this.getSelections();
    return selections[selections.length - 1] ?? null;
  }

  /**
   * Subscribe to selection changes
   * Returns cleanup function
   */
  onSelectionChange(callback: (selections: RangeAddress[]) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Format the last selection as a range string
   * e.g., "[Workbook]Sheet!A1:C10" or "[Workbook]'My Sheet'!A1:INFINITY"
   */
  formatLastSelectionAsRange(): string {
    const lastSelection = this.getLastSelection();
    if (!lastSelection) {
      return '';
    }

    const { workbookName, sheetName, range } = lastSelection;

    // Convert start position to Excel notation
    const startCol = indexToColumn(range.start.col);
    const startRow = range.start.row + 1; // Convert to 1-based

    // Convert end position to Excel notation
    let endCol: string;
    let endRow: string;

    // Handle end column
    if (range.end.col.type === 'infinity') {
      endCol = '∞';
    } else {
      endCol = indexToColumn(range.end.col.value);
    }

    // Handle end row
    if (range.end.row.type === 'infinity') {
      endRow = '∞';
    } else {
      endRow = String(range.end.row.value + 1); // Convert to 1-based
    }

    // Build range string based on what's infinite
    let rangeStr: string;
    const isColInfinity = range.end.col.type === 'infinity';
    const isRowInfinity = range.end.row.type === 'infinity';

    if (isColInfinity && isRowInfinity) {
      // Both infinite: A5:INFINITY
      rangeStr = `${startCol}${startRow}:INFINITY`;
    } else if (isColInfinity) {
      // Column infinite: A5:10 (row-bounded)
      rangeStr = `${startCol}${startRow}:${endRow}`;
    } else if (isRowInfinity) {
      // Row infinite: A5:C (col-bounded)
      rangeStr = `${startCol}${startRow}:${endCol}`;
    } else {
      // Closed rectangle: A5:C10
      rangeStr = `${startCol}${startRow}:${endCol}${endRow}`;
    }

    // Quote sheet name if it contains spaces or special characters
    const needsQuotes = /[ '!]/.test(sheetName);
    const sheetRef = needsQuotes ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;

    // Return formatted string: [Workbook]Sheet!Range
    return `[${workbookName}]${sheetRef}!${rangeStr}`;
  }

  /**
   * Blur all selection managers (remove focus from all)
   * This should be called when the component loses focus
   */
  blur(): void {
    this.managers.forEach((context, manager) => {
      manager.clearSelections();
      manager.blur();
    });
    // Clear the last focused manager and emit change to notify listeners
    this.lastFocusedManager = null;
    this.emitChange();
  }

  /**
   * Focus the selection manager for a specific workbook (first sheet found).
   * This is useful when programmatically switching focus, e.g., after maximizing a window.
   */
  focusWorkbook(workbookName: string): void {
    for (const [manager, context] of this.managers) {
      if (context.workbookName === workbookName) {
        manager.focus();
        this.lastFocusedManager = { sm: manager, context };
        this.emitChange();
        return;
      }
    }
  }

  /**
   * Focus the selection manager for a specific sheet without changing the cell selection.
   */
  focusSheet(workbookName: string, sheetName: string): boolean {
    for (const [manager, context] of this.managers) {
      if (context.workbookName === workbookName && context.sheetName === sheetName) {
        manager.focus();
        this.lastFocusedManager = { sm: manager, context };
        this.emitChange();
        return true;
      }
    }
    return false;
  }

  /**
   * Focus a specific cell in a specific workbook and sheet.
   * Finds the matching SelectionManager, sets its selection to the given cell,
   * and focuses it.
   *
   * @returns true when focused immediately, false when queued until the target
   *          sheet mounts.
   */
  focusCell(workbookName: string, sheetName: string, row: number, col: number): boolean {
    return this.focusRange({
      workbookName,
      sheetName,
      range: {
        start: { row, col },
        end: {
          row: { type: 'number', value: row },
          col: { type: 'number', value: col }
        }
      }
    });
  }

  /**
   * Focus, select and reveal a range in its workbook/sheet.
   *
   * If the sheet is not mounted yet, the latest request is queued and applied
   * when that sheet registers. This lets controlled workbooks switch their
   * active sheet before the target grid exists.
   *
   * @returns true when applied immediately, false when queued for a future mount.
   */
  focusRange(address: RangeAddress, options: WorkbookRangeFocusOptions = {}): boolean {
    const request: PendingRangeFocus = {
      address: this.cloneRangeAddress(address),
      options: { ...options }
    };

    for (const [manager, context] of this.managers) {
      if (!this.matchesContext(request.address, context)) continue;
      this.pendingRangeFocus = null;
      this.applyRangeFocus(manager, context, request);
      return true;
    }

    this.pendingRangeFocus = request;
    return false;
  }

  /**
   * Notify all listeners of selection change
   */
  private emitChange(): void {
    const currentSelection = this.getLastSelection();
    const selections = currentSelection ? [currentSelection] : [];
    this.listeners.forEach((listener) => {
      listener(selections);
    });
  }
}
