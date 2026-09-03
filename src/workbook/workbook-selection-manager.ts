import type { RangeAddress, SpreadsheetRange, SpreadsheetRangeEnd } from '@ricsam/formula-engine';
import { indexToColumn } from '@ricsam/formula-engine';
import type {
  SelectionManager,
  SMArea,
  ViewportAlignment
} from '@ricsam/selection-manager';

export interface WorkbookSelectionContext {
  workbookName: string;
  sheetName: string;
  /**
   * Stable identity for this rendered workbook view. Supply this when the same
   * workbook/sheet can be mounted more than once, such as in split-screen panes.
   */
  viewId?: string;
}

export interface WorkbookRangeFocusOptions {
  /** How the target range should be positioned in the spreadsheet viewport. */
  align?: ViewportAlignment;
  /** Target one mounted copy when the workbook/sheet is rendered more than once. */
  viewId?: string;
}

interface PendingRangeFocus {
  address: RangeAddress;
  options: WorkbookRangeFocusOptions;
}

export class WorkbookSelectionManager {
  private managers = new Map<SelectionManager, WorkbookSelectionContext>();
  private lastFocusedManager: {
    sm: SelectionManager;
    context: WorkbookSelectionContext;
  } | null = null;
  private lastSelections: RangeAddress[] = [];
  private selectionsByView = new Map<string, SMArea[]>();
  private listeners = new Set<(selections: RangeAddress[]) => void>();
  private cleanupFunctions = new Map<SelectionManager, () => void>();
  private pendingRangeFocus: PendingRangeFocus | null = null;
  private applyingRangeFocus = new Set<SelectionManager>();

  private getViewKey(context: WorkbookSelectionContext): string {
    return JSON.stringify([context.workbookName, context.sheetName, context.viewId ?? null]);
  }

  private cloneSmArea(area: SMArea): SMArea {
    return {
      start: { row: area.start.row, col: area.start.col },
      end: {
        row:
          area.end.row.type === 'infinity'
            ? { type: 'infinity' }
            : { type: 'number', value: area.end.row.value },
        col:
          area.end.col.type === 'infinity'
            ? { type: 'infinity' }
            : { type: 'number', value: area.end.col.value }
      }
    };
  }

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

  private areasToRangeAddresses(
    areas: readonly SMArea[],
    context: WorkbookSelectionContext
  ): RangeAddress[] {
    return areas.map((area) => ({
      workbookName: context.workbookName,
      sheetName: context.sheetName,
      range: this.smAreaToSpreadsheetRange(area)
    }));
  }

  private rememberSelections(
    manager: SelectionManager,
    context: WorkbookSelectionContext,
    areas: readonly SMArea[] = manager.getState().selections
  ): void {
    const cachedAreas = areas.map((area) => this.cloneSmArea(area));
    this.selectionsByView.set(this.getViewKey(context), cachedAreas);
    this.lastFocusedManager = { sm: manager, context };
    this.lastSelections = this.areasToRangeAddresses(cachedAreas, context);
  }

  private matchesContext(
    address: RangeAddress,
    context: WorkbookSelectionContext,
    viewId?: string
  ): boolean {
    return (
      address.workbookName === context.workbookName &&
      address.sheetName === context.sheetName &&
      (viewId === undefined || context.viewId === viewId)
    );
  }

  private applyRangeFocus(
    manager: SelectionManager,
    context: WorkbookSelectionContext,
    request: PendingRangeFocus
  ): void {
    const selection = this.spreadsheetRangeToSmArea(request.address.range);

    // SelectionManager notifies render subscribers for replaceSelections even
    // when this grid already has focus. Suppress only this coordinator's own
    // observers so one programmatic action emits one workbook-level update.
    this.applyingRangeFocus.add(manager);
    try {
      manager.replaceSelections([selection]);
      manager.focus();
    } finally {
      this.applyingRangeFocus.delete(manager);
    }
    manager.revealRange(selection, request.options);
    this.rememberSelections(manager, context, [selection]);
    this.emitChange();
  }

  private applyPendingRangeFocusOnMount(
    manager: SelectionManager,
    context: WorkbookSelectionContext
  ): void {
    const pending = this.pendingRangeFocus;
    if (!pending || !this.matchesContext(pending.address, context, pending.options.viewId)) return;

    // Spreadsheet registers its consumer of SelectionManager viewport requests
    // in a later effect than FormulaSheet registers with this manager. Defer
    // until that listener exists so a queued reveal cannot be lost on mount.
    queueMicrotask(() => {
      if (this.pendingRangeFocus !== pending) return;
      const mountedContext = this.managers.get(manager);
      if (
        !mountedContext ||
        !this.matchesContext(pending.address, mountedContext, pending.options.viewId)
      ) {
        return;
      }

      this.pendingRangeFocus = null;
      this.applyRangeFocus(manager, mountedContext, pending);
    });
  }

  /**
   * Register a SelectionManager with its workbook/sheet context
   * Returns a cleanup function to unregister
   */
  add(manager: SelectionManager, context: WorkbookSelectionContext): () => void {
    const registeredContext = { ...context };
    this.managers.set(manager, registeredContext);

    const cachedSelections = this.selectionsByView.get(this.getViewKey(registeredContext));
    if (cachedSelections && manager.getState().selections.length === 0) {
      manager.replaceSelections(cachedSelections);
    }

    // Listen to focus changes
    const focusCleanup = manager.observeStateChange(
      (state) => state.hasFocus,
      (hasFocus) => {
        if (hasFocus && !this.applyingRangeFocus.has(manager)) {
          this.rememberSelections(manager, registeredContext);
          this.emitChange();
        }
      }
    );

    // Listen to selection changes
    const selectionCleanup = manager.observeStateChange(
      (state) => JSON.stringify(state.selections),
      (selectionsJson) => {
        if (this.applyingRangeFocus.has(manager)) return;
        const selections = JSON.parse(selectionsJson) as SMArea[];
        if (selections && selections.length > 0) {
          this.rememberSelections(manager, registeredContext, selections);
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
        // Keep the logical selection while a FormulaWorkbook replaces the grid
        // for a sheet switch. A later mount of this view restores its own cache.
        this.rememberSelections(manager, registeredContext);
        this.lastFocusedManager = null;
      }
    };

    this.cleanupFunctions.set(manager, cleanup);
    this.applyPendingRangeFocusOnMount(manager, registeredContext);
    return cleanup;
  }

  /**
   * Get the SelectionManager that was last focused or had selection activity
   */
  getLastFocusedSelectionManager(): {
    sm: SelectionManager;
    context: WorkbookSelectionContext;
  } | null {
    return this.lastFocusedManager;
  }

  /**
   * Get all current selections from the last focused manager.
   */
  getSelections(): RangeAddress[] {
    return this.lastSelections.map((selection) => this.cloneRangeAddress(selection));
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
    this.managers.forEach((_context, manager) => {
      manager.clearSelections();
      manager.blur();
    });
    // Clear the last focused manager and emit change to notify listeners
    this.selectionsByView.clear();
    this.lastFocusedManager = null;
    this.lastSelections = [];
    this.emitChange();
  }

  /**
   * Focus the selection manager for a specific workbook (first sheet found).
   * This is useful when programmatically switching focus, e.g., after maximizing a window.
   */
  focusWorkbook(workbookName: string, viewId?: string): void {
    for (const [manager, context] of this.managers) {
      if (
        context.workbookName === workbookName &&
        (viewId === undefined || context.viewId === viewId)
      ) {
        manager.focus();
        this.rememberSelections(manager, context);
        this.emitChange();
        return;
      }
    }
  }

  /**
   * Focus the selection manager for a specific sheet without changing the cell selection.
   */
  focusSheet(workbookName: string, sheetName: string, viewId?: string): boolean {
    for (const [manager, context] of this.managers) {
      if (
        context.workbookName === workbookName &&
        context.sheetName === sheetName &&
        (viewId === undefined || context.viewId === viewId)
      ) {
        manager.focus();
        this.rememberSelections(manager, context);
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
  focusCell(
    workbookName: string,
    sheetName: string,
    row: number,
    col: number,
    options: WorkbookRangeFocusOptions = {}
  ): boolean {
    return this.focusRange(
      {
        workbookName,
        sheetName,
        range: {
          start: { row, col },
          end: {
            row: { type: 'number', value: row },
            col: { type: 'number', value: col }
          }
        }
      },
      options
    );
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
      if (!this.matchesContext(request.address, context, request.options.viewId)) continue;
      this.pendingRangeFocus = null;
      this.applyRangeFocus(manager, context, request);
      return true;
    }

    this.pendingRangeFocus = request;
    return false;
  }

  /** Cancel the latest queued range focus before its target view mounts. */
  cancelPendingFocusRange(): void {
    this.pendingRangeFocus = null;
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
