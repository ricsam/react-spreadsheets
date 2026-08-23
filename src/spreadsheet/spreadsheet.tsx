import {
  type Format,
  SelectionManager,
  type SelectionManagerState,
  useInitializeSelectionManager,
  useSelectionManager
} from '@ricsam/selection-manager';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useResizeObserver } from '../utils/use-resize-observer';
import { useColorScheme } from '../utils/use-color-scheme';
import { getContrastingTextColor } from '../utils/contrast-text';
import { cn } from '../utils/cn';
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH, HEADER_HEIGHT, HEADER_WIDTH } from './constants';

import type {
  CellRenderContext,
  SerializedCellValue,
  SpreadsheetColumnWidths,
  SpreadsheetRowHeights
} from '../types';
import { type CellDataUpdate, ClipboardUtils } from '../clipboard/clipboard-manager';
import { Frame } from '../grid/frame';
import { ViewportStream } from '../grid/types';
import { columnToIndex, getRowNumber, indexToColumn, parseCellReference, rowToLetter } from './utils';
import { CONTROLLED_ZOOM_FACTOR, MAX_ZOOM, MIN_ZOOM, ZOOM_FACTOR } from './zoom-constants';
import {
  getCellSnapAnchorFromRect,
  getRectFromCellSnapAnchor,
  moveCellSnapAnchorToNearestOrigin,
  normalizeCellSnapAnchor,
  resizeCellSnapAnchorToNearestEdges,
  type CellSnapAnchor,
  type CellSnapRect,
  type CellSnapResizeHandle
} from './snapping';

/**
 * Resolves the grid line color used for canvas painting.
 *
 * Canvas 2D cannot evaluate CSS, so the themed `--rsp-gridline` value has to be
 * resolved to a concrete color first. Reading the custom property directly is
 * not enough: custom properties compute to an unresolved token sequence, so a
 * `light-dark()` value comes back verbatim and is not paintable.
 *
 * Instead we read a real, inherited property (`color`) from a hidden probe
 * element that declares `color: var(--_rsp-gridline)`. The browser resolves
 * `light-dark()` against the probe's inherited `color-scheme`, which yields a
 * paintable `rgb(...)` string that always matches what the DOM is showing.
 */
const resolveGridLineColor = (
  probe: HTMLElement | null,
  colorScheme: 'light' | 'dark'
): string => {
  const fallback = colorScheme === 'dark' ? '#232c3d' : '#e8ebf1';

  if (!probe || typeof getComputedStyle !== 'function') {
    return fallback;
  }

  const resolved = getComputedStyle(probe).color?.trim();

  // A fully transparent result means the probe never received a usable value.
  if (!resolved || resolved.includes('light-dark(') || resolved === 'rgba(0, 0, 0, 0)') {
    return fallback;
  }

  return resolved;
};

/**
 * Keeps consumer-supplied cell fills readable in both color schemes.
 *
 * A custom `backgroundColor` is normally a literal from the document model and
 * has no dark-mode variant, while the grid's default ink follows the active
 * scheme. Pairing a light literal fill with the dark theme's near-white text
 * produces unreadable cells, so when the consumer set a background but no
 * explicit text color we derive a readable one from that background.
 */
const withReadableTextColor = (
  style: React.CSSProperties | undefined
): React.CSSProperties | undefined => {
  if (!style?.backgroundColor || style.color) return style;

  const background = style.backgroundColor;
  if (typeof background !== 'string') return style;

  const color = getContrastingTextColor(background);
  if (!color) return style;

  return { ...style, color };
};

const hasBorderStyle = (style?: React.CSSProperties): boolean =>
  Boolean(
    style?.borderColor ||
      style?.borderTopColor ||
      style?.borderRightColor ||
      style?.borderBottomColor ||
      style?.borderLeftColor
  );

// Cell component with callback ref for optimal performance
const CellComponent = React.memo(
  ({
    value,
    row,
    col,
    selectionManager,
    cellToPixelBase,
    getColumnWidth,
    getRowHeight,
    customCellStyle,
    customCellRenderer,
    inputValue,
    editInputVersion,
    width,
    height
  }: {
    selectionManager: SelectionManager;
    cellToPixelBase: (row: number, col: string) => { x: number; y: number };
    getColumnWidth: (col: string) => number;
    getRowHeight: (row: number) => number;
    customCellStyle?: (cell: CellRenderContext) => React.CSSProperties;
    customCellRenderer?: (cell: CellRenderContext) => React.ReactNode;
    width?: number;
    height?: number;
    inputValue: SerializedCellValue;
    editInputVersion: number;
  } & CellData) => {
    const cellRef = useCallback(
      (el: HTMLElement | null) => {
        if (el) {
          const rowIndex = row - 1; // Convert to 0-based
          const colIndex = columnToIndex(col);
          return selectionManager.setupCellElement(el, {
            row: rowIndex,
            col: colIndex
          });
        }
      },
      [row, col, selectionManager]
    );

    // Track hook state changes
    const colIndex = columnToIndex(col);
    const rowIndex = row - 1;
    const isSelected = useSelectionManager(selectionManager, () =>
      selectionManager.isSelected({ row: rowIndex, col: colIndex })
    );
    const isBeingEdited = useSelectionManager(selectionManager, () =>
      selectionManager.isEditingCell(rowIndex, colIndex)
    );

    const { x, y } = cellToPixelBase(row, col);
    const cellStyleCallbackData: CellRenderContext = {
      id: `${col}${row}`,
      row: getRowNumber(row),
      col,
      rowIndex: row - 1,
      colIndex: columnToIndex(col),
      value,
      isSelected: isSelected,
      isBeingEdited: isBeingEdited || false
    };
    const customStyle = withReadableTextColor(customCellStyle?.(cellStyleCallbackData));

    const canHaveFillHandle = useSelectionManager(selectionManager, () => {
      return selectionManager.canCellHaveFillHandle({
        row: rowIndex,
        col: colIndex
      });
    });

    const inputRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        if (el) {
          const rowIndex = row - 1; // Convert to 0-based
          const colIndex = columnToIndex(col);
          return selectionManager.setupInputElement(el as unknown as HTMLInputElement, {
            rowIndex,
            colIndex
          });
        }
      },
      [row, col, selectionManager]
    );

    return (
      <div
        ref={cellRef}
        className={cn('rsp-cell', {
          'rsp-cell-multiline': typeof value === 'string' && value.includes('\n'),
          'rsp-cell-selected': isSelected,
          'rsp-cell-editing': isBeingEdited,
          // Selection tinting is only applied when the consumer has not taken
          // over the background, so custom borders/fills stay visible.
          'rsp-cell-plain': !(hasBorderStyle(customStyle) && !customStyle?.backgroundColor)
        })}
        data-testid={`spreadsheet-cell-${col}${row}`}
        style={{
          left: x,
          top: y,
          width: getColumnWidth(col) - 1,
          height: getRowHeight(row) - 1,
          ...customStyle,
          // While editing, the cell must present the plain editor surface. The
          // custom style is applied inline and would otherwise outrank the
          // stylesheet, leaving the typed text on a conditional fill.
          ...(isBeingEdited
            ? { backgroundColor: undefined, color: undefined }
            : null)
        }}
      >
        {isBeingEdited ? (
          <textarea
            key={editInputVersion}
            className="rsp-cell-editor"
            data-testid={`spreadsheet-cell-input-${col}${row}`}
            ref={inputRef}
            defaultValue={inputValue?.toString() ?? ''}
            onKeyDownCapture={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            style={{
              left: x + 4,
              top: y + 4,
              width,
              height
            }}
          />
        ) : customCellRenderer ? (
          customCellRenderer(cellStyleCallbackData)
        ) : (
          value
        )}
        {canHaveFillHandle && (
          <div
            className="rsp-fill-handle"
            data-fill-handle={true}
            data-testid={`spreadsheet-fill-handle-${col}${row}`}
          />
        )}
      </div>
    );
  }
);

CellComponent.displayName = 'CellComponent';

// Header component with callback ref for optimal performance
const HeaderComponent = React.memo(
  ({
    index,
    type,
    selectionManager,
    reverseHeaders,
    getColumnWidth,
    getRowHeight,
    handleColumnResizeStart,
    handleColumnResizeDoubleClick,
    handleRowResizeStart,
    handleRowResizeDoubleClick
  }: {
    index: number;
    type: 'row' | 'col';
    selectionManager: SelectionManager;
    reverseHeaders?: boolean;
    getColumnWidth: (col: string) => number;
    getRowHeight: (row: number) => number;
    handleColumnResizeStart: (e: React.MouseEvent, col: string) => void;
    handleColumnResizeDoubleClick: (e: React.MouseEvent, col: string) => void;
    handleRowResizeStart: (e: React.MouseEvent, row: number) => void;
    handleRowResizeDoubleClick: (e: React.MouseEvent, row: number) => void;
  }) => {
    const headerRef = useCallback(
      (el: HTMLElement | null) => {
        if (el) {
          return selectionManager.setupHeaderElement(el, index, type);
        }
      },
      [index, type, selectionManager]
    );

    // Calculate position and size based on index and type
    const { position, size } = React.useMemo(() => {
      if (type === 'col') {
        const col = indexToColumn(index);
        const width = getColumnWidth(col);
        const height = HEADER_HEIGHT;

        // Calculate x position
        let x = 0;
        for (let i = 0; i < index; i++) {
          const colKey = indexToColumn(i);
          x += getColumnWidth(colKey);
        }

        return {
          position: { x, y: 0 },
          size: { width, height }
        };
      } else {
        // row header
        const row = index + 1;
        const width = HEADER_WIDTH;
        const height = getRowHeight(row);

        // Calculate y position
        let y = 0;
        for (let i = 1; i <= index; i++) {
          y += getRowHeight(i);
        }

        return {
          position: { x: 0, y },
          size: { width, height }
        };
      }
    }, [index, type, getColumnWidth, getRowHeight]);

    // Check if this header is selected
    const isSelected = useSelectionManager(selectionManager, () => {
      if (type === 'col') {
        return selectionManager.isWholeColSelected(index);
      } else {
        return selectionManager.isWholeRowSelected(index);
      }
    });

    const content =
      type === 'col'
        ? reverseHeaders
          ? index + 1
          : indexToColumn(index)
        : reverseHeaders
          ? rowToLetter(index + 1)
          : index + 1;

    return (
      <div
        ref={headerRef}
        className={cn('rsp-header', `rsp-header-${type}`, {
          'rsp-header-selected': isSelected
        })}
        data-testid={`spreadsheet-${type}-header-${type === 'col' ? indexToColumn(index) : index + 1}`}
        style={{
          left: position.x,
          top: position.y,
          width: size.width - 1,
          height: size.height - 1
        }}
      >
        {content}
        {type === 'col' && (
          <div
            className="rsp-col-resize-handle"
            data-testid={`spreadsheet-column-resize-handle-${indexToColumn(index)}`}
            onMouseDown={(e) => handleColumnResizeStart(e, indexToColumn(index))}
            onDoubleClick={(e) => handleColumnResizeDoubleClick(e, indexToColumn(index))}
          />
        )}
        {type === 'row' && (
          <div
            className="rsp-row-resize-handle"
            data-testid={`spreadsheet-row-resize-handle-${index + 1}`}
            onMouseDown={(e) => handleRowResizeStart(e, index + 1)}
            onDoubleClick={(e) => handleRowResizeDoubleClick(e, index + 1)}
          />
        )}
      </div>
    );
  }
);

HeaderComponent.displayName = 'HeaderComponent';

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

// Types and interfaces
interface CellData {
  value: SerializedCellValue;
  /**
   * The row of the cell, e.g. 1, 2, 3, etc.
   */
  row: number;
  /**
   * The column of the cell, e.g. "A", "B", "C", etc.
   */
  col: string;
}

// Overlay component types (similar to Grid)
export interface SpreadsheetChildInitial {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom?: number;
}

export interface SpreadsheetChild {
  id: string;
  title: string;
  x: number; // pixel position relative to cell grid (before zoom/scroll applied)
  y: number;
  width: number;
  height: number;
  zoom?: number;
  snapToCells?: boolean;
  cellAnchor?: CellSnapAnchor;
  minimized?: boolean;
  initial?: SpreadsheetChildInitial;
  component: string;
  canClose?: boolean;
  persistent?: boolean;
  props?: any;
}

export interface SpreadsheetChildState {
  isSelected: boolean;
  isMinimized: boolean;
}

export type SpreadsheetComponent = (child: SpreadsheetChild, state: SpreadsheetChildState) => ReactNode;

const columnWidthsRecordToMap = (columnWidths?: SpreadsheetColumnWidths): Map<string, number> => {
  return new Map(
    Object.entries(columnWidths || {}).filter((entry): entry is [string, number] => {
      const width = entry[1];
      return typeof width === 'number' && Number.isFinite(width) && width > 0;
    })
  );
};

const columnWidthsMapToRecord = (columnWidths: Map<string, number>): SpreadsheetColumnWidths => {
  const result: SpreadsheetColumnWidths = {};
  columnWidths.forEach((width, column) => {
    if (Number.isFinite(width) && width > 0) {
      result[column] = width;
    }
  });
  return result;
};

const rowHeightsRecordToMap = (rowHeights?: SpreadsheetRowHeights): Map<number, number> => {
  const entries = Object.entries(rowHeights || {}).flatMap(([row, height]) => {
    const rowNumber = Number(row);
    if (Number.isInteger(rowNumber) && rowNumber > 0 && Number.isFinite(height) && height > 0) {
      return [[rowNumber, height] as [number, number]];
    }
    return [];
  });

  return new Map(entries);
};

const rowHeightsMapToRecord = (rowHeights: Map<number, number>): SpreadsheetRowHeights => {
  const result: SpreadsheetRowHeights = {};
  rowHeights.forEach((height, row) => {
    if (Number.isInteger(row) && row > 0 && Number.isFinite(height) && height > 0) {
      result[row] = height;
    }
  });
  return result;
};

const isSnappedTextBox = (child: SpreadsheetChild): boolean =>
  child.component === 'RichText' && Boolean(child.snapToCells);

const areCellSnapAnchorsEqual = (a: CellSnapAnchor, b: CellSnapAnchor): boolean =>
  a.startCol === b.startCol && a.startRow === b.startRow && a.endCol === b.endCol && a.endRow === b.endRow;

const applyCellSnapAnchorToTextBox = (
  child: SpreadsheetChild,
  anchor: CellSnapAnchor,
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): SpreadsheetChild => {
  const normalizedAnchor = normalizeCellSnapAnchor(anchor);
  const rect = getRectFromCellSnapAnchor(normalizedAnchor, columnWidths, rowHeights);

  return {
    ...child,
    snapToCells: true,
    cellAnchor: normalizedAnchor,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
};

const syncSnappedTextBoxRects = (
  children: SpreadsheetChild[],
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): SpreadsheetChild[] => {
  let changed = false;

  const nextChildren = children.map((child) => {
    if (!isSnappedTextBox(child)) {
      return child;
    }

    const fallbackAnchor = getCellSnapAnchorFromRect(child, columnWidths, rowHeights);
    const anchor = child.cellAnchor ? normalizeCellSnapAnchor(child.cellAnchor) : fallbackAnchor;
    const rect = getRectFromCellSnapAnchor(anchor, columnWidths, rowHeights);
    const currentAnchor = child.cellAnchor ? normalizeCellSnapAnchor(child.cellAnchor) : undefined;
    const anchorChanged = !currentAnchor || !areCellSnapAnchorsEqual(currentAnchor, anchor);
    const rectChanged =
      child.x !== rect.x || child.y !== rect.y || child.width !== rect.width || child.height !== rect.height;

    if (!anchorChanged && !rectChanged) {
      return child;
    }

    changed = true;
    return {
      ...child,
      cellAnchor: anchor,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  });

  return changed ? nextChildren : children;
};

const isCellSnapResizeHandle = (handle: string): handle is CellSnapResizeHandle => {
  return (
    handle === 'top' ||
    handle === 'right' ||
    handle === 'bottom' ||
    handle === 'left' ||
    handle === 'top-left' ||
    handle === 'top-right' ||
    handle === 'bottom-left' ||
    handle === 'bottom-right'
  );
};

export interface SpreadsheetProps {
  style?: React.CSSProperties;
  /** Extra class name applied to the outer `.rsp-root` element. */
  className?: string;
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
  cellData?: Map<string, SerializedCellValue>;
  onCellDataChange?: (data: Map<string, SerializedCellValue>) => void;
  onCellDataChangeError?: (error: unknown) => void;
  columnWidths?: SpreadsheetColumnWidths;
  onColumnWidthsChange?: (columnWidths: SpreadsheetColumnWidths) => void;
  rowHeights?: SpreadsheetRowHeights;
  onRowHeightsChange?: (rowHeights: SpreadsheetRowHeights) => void;
  customCellStyle?: (cell: CellRenderContext) => React.CSSProperties;
  customCellRenderer?: (cell: CellRenderContext) => React.ReactNode;
  /**
   * Used for saving the value to the cell data. Most useful for parsing a pasted
   * string value to a number.
   */
  parseValue?: (
    value: string,
    cell: {
      id: string;
      row: number;
      col: string;
      rowIndex: number;
      colIndex: number;
    }
  ) => string | number;

  selection?: {
    initialState?: Partial<SelectionManagerState>;
    state?: SelectionManagerState;
    onStateChange?: (state: SelectionManagerState) => void;
    effects?: (selectionManager: SelectionManager) => (() => void) | void;
    formats?: Format[];
  };

  // Overlay component props
  components?: Record<string, SpreadsheetComponent>;
  overlayChildren?: SpreadsheetChild[];
  selectedOverlayId?: string | null;
  onOverlaySelect?: (childId: string | null) => void;
  onOverlayChildrenChange?: (children: SpreadsheetChild[]) => void;
  overlayPlaceholder?: {
    componentType: string;
    title: string;
    width: number;
    height: number;
    onPlaced: (x: number, y: number) => void;
    onCancel?: () => void;
  };
  /** Whether the parent component is selected (used to gate overlay selection) */
  parentSelected?: boolean;
}

interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

interface GridDimensions {
  cellWidth: number;
  cellHeight: number;
  headerWidth: number;
  headerHeight: number;
}

// Ref interface for imperative methods
export interface SpreadsheetRef {
  focus: () => void;
  blur: () => void;
}

class SpreadsheetClipboardManager extends ClipboardUtils {
  constructor(
    private cellDataRef: React.RefObject<Map<string, SerializedCellValue>>,
    private selectionManager: SelectionManager
  ) {
    super();
  }
  public triggerCopy() {
    const extractedCells = this.extractCellsFromSelection(this.selectionManager, this.cellDataRef.current);

    if (!extractedCells) return;

    const { width, height, cells } = extractedCells;

    const exportGrid = this.createExportGrid(width, height);

    cells.forEach(({ relative, value }) => {
      const row = exportGrid[relative.rowIndex];
      if (!row) return;
      row[relative.columnIndex] = value === undefined ? '' : String(value);
    });

    this.writeToOsClipboard(exportGrid);
  }
  public triggerPaste(updates: CellDataUpdate[]) {
    this.selectionManager.saveCellValues(updates);
  }
}

// Main component
export const Spreadsheet = forwardRef<
  SpreadsheetRef | undefined,
  SpreadsheetProps & {
    disableClipboard?: boolean;
  }
>(
  (
    {
      style,
      className,
      containerProps,
      cellData: controlledCellData,
      onCellDataChange,
      onCellDataChangeError,
      columnWidths: controlledColumnWidths,
      onColumnWidthsChange,
      rowHeights: controlledRowHeights,
      onRowHeightsChange,
      customCellStyle,
      customCellRenderer,
      parseValue,
      selection,
      components,
      overlayChildren: controlledOverlayChildren,
      selectedOverlayId: controlledSelectedOverlayId,
      onOverlaySelect,
      onOverlayChildrenChange,
      overlayPlaceholder,
      parentSelected = true,
      disableClipboard = false
    },
    ref
  ) => {
    const [{ width, height }, containerRef] = useResizeObserver();
    const [containerDivRef, setContainerDivRef] = useState<HTMLDivElement | null>(null);
    // Resolved from the mounted element so a consumer can pin a subtree to
    // light or dark via `color-scheme` and have canvas gridlines follow.
    const colorScheme = useColorScheme(containerDivRef);
    // Hidden element used to read the browser-resolved `--rsp-gridline` color
    // for canvas painting (see `resolveGridLineColor`).
    const gridLineProbeRef = useRef<HTMLSpanElement | null>(null);

    const selectionManager = useInitializeSelectionManager({
      getNumCols: () => ({ type: 'infinity' }),
      getNumRows: () => ({ type: 'infinity' }),
      initialState: selection?.initialState,
      state: selection?.state,
      onStateChange: selection?.onStateChange,
      containerElement: containerDivRef,
      formats: selection?.formats,
      disableAutoClipboard: true
    });

    const effects = selection?.effects;
    useEffect(() => {
      if (effects) {
        return effects(selectionManager);
      }
    }, [selectionManager, effects]);

    // State management
    const [internalCellData, setInternalCellData] = useState<Map<string, SerializedCellValue>>(new Map());
    const [retryingEdit, setRetryingEdit] = useState<{
      rowIndex: number;
      colIndex: number;
      version: number;
    } | null>(null);
    const retryingEditVersionRef = useRef(0);

    // Use controlled cellData if provided, otherwise use internal state
    const cellData = controlledCellData ?? internalCellData;

    const cellDataRef = useRef(cellData);
    cellDataRef.current = cellData;

    const isControlled = controlledCellData !== undefined;
    const prevIsControlledRef = useRef(isControlled);

    selectionManager.getCellsWithData = (area) => {
      const cells: { rowIndex: number; colIndex: number }[] = [];
      cellData.forEach((value, key) => {
        const { rowIndex, columnIndex } = parseCellReference(key);
        if (
          columnIndex >= area.start.col &&
          (area.end.col.type === 'infinity' || columnIndex <= area.end.col.value) &&
          rowIndex >= area.start.row &&
          (area.end.row.type === 'infinity' || rowIndex <= area.end.row.value)
        ) {
          cells.push({ rowIndex, colIndex: columnIndex });
        }
      });
      return cells;
    };

    React.useEffect(() => {
      if (isControlled !== prevIsControlledRef.current) {
        prevIsControlledRef.current = isControlled;
        console.warn(
          `The component went from ${
            prevIsControlledRef.current ? 'controlled' : 'uncontrolled'
          } to ${isControlled ? 'controlled' : 'uncontrolled'}, this is not supported`
        );
      }
    }, [controlledCellData, isControlled]);

    const [viewport, setViewport] = useState<ViewportState>({
      scrollX: 0,
      scrollY: 0,
      zoom: 1
    });
    const controlledColumnWidthsMap = useMemo(
      () => (controlledColumnWidths ? columnWidthsRecordToMap(controlledColumnWidths) : undefined),
      [controlledColumnWidths]
    );
    const [internalColumnWidths, setInternalColumnWidths] = useState<Map<string, number>>(() =>
      columnWidthsRecordToMap(controlledColumnWidths)
    );
    const [transientColumnWidths, setTransientColumnWidths] = useState<Map<string, number> | null>(null);
    const columnWidths = transientColumnWidths ?? controlledColumnWidthsMap ?? internalColumnWidths;
    const columnWidthsRef = useRef(columnWidths);
    columnWidthsRef.current = columnWidths;
    const previousControlledColumnWidthsRef = useRef(controlledColumnWidths);
    useEffect(() => {
      if (controlledColumnWidths !== previousControlledColumnWidthsRef.current) {
        previousControlledColumnWidthsRef.current = controlledColumnWidths;
        setTransientColumnWidths(null);
      }
    }, [controlledColumnWidths]);
    const controlledRowHeightsMap = useMemo(
      () => (controlledRowHeights ? rowHeightsRecordToMap(controlledRowHeights) : undefined),
      [controlledRowHeights]
    );
    const [internalRowHeights, setInternalRowHeights] = useState<Map<number, number>>(() =>
      rowHeightsRecordToMap(controlledRowHeights)
    );
    const [transientRowHeights, setTransientRowHeights] = useState<Map<number, number> | null>(null);
    const rowHeights = transientRowHeights ?? controlledRowHeightsMap ?? internalRowHeights;
    const rowHeightsRef = useRef(rowHeights);
    rowHeightsRef.current = rowHeights;
    const previousControlledRowHeightsRef = useRef(controlledRowHeights);
    useEffect(() => {
      if (controlledRowHeights !== previousControlledRowHeightsRef.current) {
        previousControlledRowHeightsRef.current = controlledRowHeights;
        setTransientRowHeights(null);
      }
    }, [controlledRowHeights]);

    const [isResizingColumn, setIsResizingColumn] = useState<string | null>(null);
    const [isResizingRow, setIsResizingRow] = useState<number | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartY, setResizeStartY] = useState(0);
    const [resizeStartSize, setResizeStartSize] = useState(0);

    // Overlay state management
    const [internalOverlayChildren, setInternalOverlayChildren] = useState<SpreadsheetChild[]>([]);
    const [transientOverlayChildren, setTransientOverlayChildren] = useState<SpreadsheetChild[] | null>(null);
    const [internalSelectedOverlayId, setInternalSelectedOverlayId] = useState<string | null>(null);
    const [mountedPersistentOverlayIds, setMountedPersistentOverlayIds] = useState<Set<string>>(new Set());

    // Placeholder state for overlay placement
    const [placeholderPos, setPlaceholderPos] = useState<{ x: number; y: number } | null>(null);

    // Use transient overlay state while dragging/resizing, then commit once the interaction ends.
    const overlayChildren = transientOverlayChildren ?? controlledOverlayChildren ?? internalOverlayChildren;
    const selectedOverlayId =
      controlledSelectedOverlayId !== undefined ? controlledSelectedOverlayId : internalSelectedOverlayId;

    const previousControlledOverlayChildrenRef = useRef(controlledOverlayChildren);
    useEffect(() => {
      if (controlledOverlayChildren !== previousControlledOverlayChildrenRef.current) {
        previousControlledOverlayChildrenRef.current = controlledOverlayChildren;
        setTransientOverlayChildren(null);
      }
    }, [controlledOverlayChildren]);

    const overlayChildrenRef = useRef<SpreadsheetChild[]>(overlayChildren);
    overlayChildrenRef.current = overlayChildren;
    const overlayInteractionDraftRectsRef = useRef<Record<string, CellSnapRect>>({});
    const pendingSnappedTextBoxLayoutCommitRef = useRef(false);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const viewportStreamRef = useRef(
      new ViewportStream({
        x: viewport.scrollX,
        y: viewport.scrollY,
        zoom: viewport.zoom
      })
    );

    // Update viewport stream when viewport changes
    React.useEffect(() => {
      viewportStreamRef.current.next({
        x: viewport.scrollX,
        y: viewport.scrollY,
        zoom: viewport.zoom
      });
    }, [viewport.scrollX, viewport.scrollY, viewport.zoom]);
    // Grid dimensions
    const gridDims: GridDimensions = useMemo(
      () => ({
        cellWidth: DEFAULT_CELL_WIDTH * viewport.zoom,
        cellHeight: DEFAULT_CELL_HEIGHT * viewport.zoom,
        headerWidth: HEADER_WIDTH * viewport.zoom,
        headerHeight: HEADER_HEIGHT * viewport.zoom
      }),
      [viewport.zoom]
    );

    // Handle mouse movement for placeholder positioning
    React.useEffect(() => {
      if (!overlayPlaceholder || !containerDivRef) return;

      const handleMouseMove = (e: MouseEvent) => {
        const rect = containerDivRef.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Check if mouse is within the spreadsheet (after headers)
        if (mouseX >= gridDims.headerWidth && mouseY >= gridDims.headerHeight) {
          // Convert screen coordinates to sheet coordinates (centered on cursor)
          const sheetX =
            (mouseX - gridDims.headerWidth + viewport.scrollX) / viewport.zoom - overlayPlaceholder.width / 2;
          const sheetY =
            (mouseY - gridDims.headerHeight + viewport.scrollY) / viewport.zoom -
            overlayPlaceholder.height / 2;

          // Clamp to minimum bounds (can't be negative or overlap headers)
          const clampedX = Math.max(0, sheetX);
          const clampedY = Math.max(0, sheetY);

          setPlaceholderPos({ x: clampedX, y: clampedY });
        } else {
          // Clear placeholder position when mouse is over headers
          setPlaceholderPos(null);
        }
      };

      const handleClick = (e: MouseEvent) => {
        if (placeholderPos) {
          e.stopPropagation();
          // Final bounds check before placement
          const finalX = Math.max(0, placeholderPos.x);
          const finalY = Math.max(0, placeholderPos.y);
          overlayPlaceholder.onPlaced(finalX, finalY);
          setPlaceholderPos(null);
        }
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          overlayPlaceholder.onCancel?.();
          setPlaceholderPos(null);
        }
      };

      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        overlayPlaceholder.onCancel?.();
        setPlaceholderPos(null);
      };

      containerDivRef.addEventListener('mousemove', handleMouseMove);
      containerDivRef.addEventListener('click', handleClick);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('contextmenu', handleContextMenu);

      return () => {
        containerDivRef.removeEventListener('mousemove', handleMouseMove);
        containerDivRef.removeEventListener('click', handleClick);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('contextmenu', handleContextMenu);
      };
    }, [overlayPlaceholder, containerDivRef, viewport, gridDims, placeholderPos]);

    const effectsRefOb = {
      onCellDataChange,
      onCellDataChangeError,
      controlledCellData,
      parseValue,
      cellData,
      viewport,
      gridDims,
      height
    };
    const effectsRef = useRef(effectsRefOb);
    effectsRef.current = effectsRefOb;

    // Styles are now imported via CSS module

    // Helper function to setup canvas with devicePixelRatio scaling
    const setupCanvas = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const devicePixelRatio = window.devicePixelRatio || 1;

      // Set actual size in memory (scaled for high-DPI)
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;

      // Set display size (CSS pixels)
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      // Scale the drawing context so everything draws at the correct size
      ctx.scale(devicePixelRatio, devicePixelRatio);

      return ctx;
    }, []);

    // Draw main grid on canvas
    const drawGrid = useCallback(() => {
      if (!canvasRef.current || !width || !height) return;

      const ctx = setupCanvas(canvasRef.current, width, height);
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      // Canvas 2D cannot evaluate CSS, so read the resolved gridline color from
      // a hidden probe element that the browser has already themed for us.
      ctx.strokeStyle = resolveGridLineColor(gridLineProbeRef.current, colorScheme);
      ctx.lineWidth = 1;

      // Draw vertical grid lines using custom column widths
      let x = gridDims.headerWidth;
      let colIndex = 0;

      // Skip columns before viewport
      while (x < viewport.scrollX + gridDims.headerWidth) {
        const colWidth = (columnWidths.get(indexToColumn(colIndex)) || DEFAULT_CELL_WIDTH) * viewport.zoom;
        if (x + colWidth > viewport.scrollX + gridDims.headerWidth) {
          break;
        }
        x += colWidth;
        colIndex++;
      }

      // Draw visible columns
      while (x - viewport.scrollX < width) {
        const drawX = x - viewport.scrollX;
        if (drawX >= gridDims.headerWidth && drawX <= width) {
          ctx.beginPath();
          ctx.moveTo(drawX, gridDims.headerHeight);
          ctx.lineTo(drawX, height);
          ctx.stroke();
        }
        const colWidth = (columnWidths.get(indexToColumn(colIndex)) || DEFAULT_CELL_WIDTH) * viewport.zoom;
        x += colWidth;
        colIndex++;
      }

      // Draw horizontal grid lines using custom row heights
      let y = gridDims.headerHeight;
      let rowNum = 1;

      // Skip rows before viewport
      while (y < viewport.scrollY + gridDims.headerHeight) {
        const rowHeight = (rowHeights.get(rowNum) || DEFAULT_CELL_HEIGHT) * viewport.zoom;
        if (y + rowHeight > viewport.scrollY + gridDims.headerHeight) {
          break;
        }
        y += rowHeight;
        rowNum++;
      }

      // Draw visible rows
      while (y - viewport.scrollY < height) {
        const drawY = y - viewport.scrollY;
        if (drawY >= gridDims.headerHeight && drawY <= height) {
          ctx.beginPath();
          ctx.moveTo(gridDims.headerWidth, drawY);
          ctx.lineTo(width, drawY);
          ctx.stroke();
        }
        const rowHeight = (rowHeights.get(rowNum) || DEFAULT_CELL_HEIGHT) * viewport.zoom;
        y += rowHeight;
        rowNum++;
      }
    }, [
      columnWidths,
      gridDims.headerHeight,
      gridDims.headerWidth,
      height,
      rowHeights,
      setupCanvas,
      viewport.scrollX,
      viewport.scrollY,
      viewport.zoom,
      width,
      colorScheme
    ]);

    // Get visible cells for rendering - ensure we always render all visible positions
    const getVisibleCells = useCallback(() => {
      if (!width || !height) return [];

      const cells: CellData[] = [];

      // Find first visible column
      let x = 0;
      let startCol = 0;
      while (x < viewport.scrollX) {
        const colWidth = (columnWidths.get(indexToColumn(startCol)) || DEFAULT_CELL_WIDTH) * viewport.zoom;
        if (x + colWidth > viewport.scrollX) {
          break;
        }
        x += colWidth;
        startCol++;
      }

      // Find first visible row
      let y = 0;
      let startRow = 0;
      while (y < viewport.scrollY) {
        const rowHeight = (rowHeights.get(startRow + 1) || DEFAULT_CELL_HEIGHT) * viewport.zoom;
        if (y + rowHeight > viewport.scrollY) {
          break;
        }
        y += rowHeight;
        startRow++;
      }

      // Collect visible cells
      let rowY = y;
      let row = startRow;
      while (rowY < viewport.scrollY + height) {
        let colX = x;
        let col = startCol;
        while (colX < viewport.scrollX + width) {
          const colKey = indexToColumn(col);
          const rowNum = getRowNumber(row);
          const cellKey = `${colKey}${rowNum}`;
          cells.push({
            value: cellData.get(cellKey) ?? '',
            row: rowNum,
            col: colKey
          });
          const colWidth = (columnWidths.get(colKey) || DEFAULT_CELL_WIDTH) * viewport.zoom;
          colX += colWidth;
          col++;
        }
        const rowHeight = (rowHeights.get(row + 1) || DEFAULT_CELL_HEIGHT) * viewport.zoom;
        rowY += rowHeight;
        row++;
      }

      return cells;
    }, [
      cellData,
      columnWidths,
      height,
      rowHeights,
      viewport.scrollX,
      viewport.scrollY,
      viewport.zoom,
      width
    ]);

    // Get column width (considering custom sizes)
    const getColumnWidth = useCallback(
      (col: string) => {
        return columnWidths.get(col) || DEFAULT_CELL_WIDTH;
      },
      [columnWidths]
    );

    // Get row height (considering custom sizes)
    const getRowHeight = useCallback(
      (row: number) => {
        return rowHeights.get(row) || DEFAULT_CELL_HEIGHT;
      },
      [rowHeights]
    );

    // Convert cell coordinates to base pixel coordinates (without scroll offset, for container transform)
    const cellToPixelBase = useCallback(
      (row: number, col: string) => {
        const colIndex = columnToIndex(col);
        const rowIndex = row - 1;

        // Calculate x position considering custom column widths
        let x = HEADER_WIDTH;
        for (let i = 0; i < colIndex; i++) {
          const colKey = indexToColumn(i);
          x += columnWidths.get(colKey) || DEFAULT_CELL_WIDTH;
        }

        // Calculate y position considering custom row heights
        let y = HEADER_HEIGHT;
        for (let i = 1; i <= rowIndex; i++) {
          y += rowHeights.get(i) || DEFAULT_CELL_HEIGHT;
        }

        return { x, y };
      },
      [columnWidths, rowHeights]
    );

    React.useEffect(() => {
      return selectionManager.listenToUpdateData((updates) => {
        const editingState = selectionManager.isEditing;
        try {
          const { cellData, onCellDataChange } = effectsRef.current;
          const newData = new Map(cellData);
          updates.forEach(({ value, rowIndex, colIndex }) => {
            const key = `${indexToColumn(colIndex)}${rowIndex + 1}`;
            const parseValue = effectsRef.current.parseValue;
            if (value === '') {
              newData.delete(key);
            } else {
              // Apply parse function if provided, otherwise use value as-is
              let parsedValue: number | string = value;
              if (parseValue && typeof value === 'string') {
                // Extract cell info from key (e.g., "A1" -> row=1, col="A")
                const match = key.match(/^([A-Z]+)(\d+)$/);
                const col = match?.[1];
                const rowText = match?.[2];
                if (col && rowText) {
                  const row = parseInt(rowText, 10);
                  const colIndex = columnToIndex(col);
                  const rowIndex = row - 1;

                  parsedValue = parseValue(value, {
                    id: key,
                    row,
                    col,
                    rowIndex,
                    colIndex
                  });
                }
              }
              newData.set(key, parsedValue);
            }
          });
          onCellDataChange?.(newData);
          setInternalCellData(newData);
        } catch (error) {
          console.error('Failed to update spreadsheet cell data:', error);
          effectsRef.current.onCellDataChangeError?.(error);

          const rejectedUpdate = updates.length === 1 ? updates[0] : undefined;
          if (
            editingState.type === 'cell' &&
            rejectedUpdate &&
            rejectedUpdate.rowIndex === editingState.row &&
            rejectedUpdate.colIndex === editingState.col
          ) {
            const rejectedValue = rejectedUpdate.value === undefined ? '' : String(rejectedUpdate.value);
            queueMicrotask(() => {
              retryingEditVersionRef.current += 1;
              setRetryingEdit({
                rowIndex: editingState.row,
                colIndex: editingState.col,
                version: retryingEditVersionRef.current
              });
              selectionManager.editCell(editingState.row, editingState.col, rejectedValue);
            });
          }
        }
      });
    }, [selectionManager]);

    const clipboardManager = useMemo(() => {
      return new SpreadsheetClipboardManager(cellDataRef, selectionManager);
    }, [selectionManager]);

    React.useEffect(() => {
      if (disableClipboard) return;
      selectionManager.listenToCopy(() => {
        clipboardManager.triggerCopy();
      });
    }, [selectionManager, clipboardManager, disableClipboard]);

    React.useEffect(() => {
      if (disableClipboard) return;
      selectionManager.listenToPaste(({ updates }) => {
        clipboardManager.triggerPaste(updates);
      });
    }, [selectionManager, clipboardManager, disableClipboard]);

    // Handle wheel events (scroll only, zoom disabled)
    const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Always scroll, ignore zoom
      setViewport((prev) => ({
        ...prev,
        scrollX: Math.max(0, prev.scrollX + e.deltaX),
        scrollY: Math.max(0, prev.scrollY + e.deltaY)
      }));
    }, []);

    // Overlay interaction handlers
    const commitOverlayChildren = useCallback(
      (children: SpreadsheetChild[]) => {
        overlayChildrenRef.current = children;

        if (onOverlayChildrenChange) {
          onOverlayChildrenChange(children);
          setTransientOverlayChildren(children);
          return;
        }

        setInternalOverlayChildren(children);
        setTransientOverlayChildren(null);
      },
      [onOverlayChildrenChange]
    );

    const updateOverlayChildrenLocally = useCallback(
      (updater: (children: SpreadsheetChild[]) => SpreadsheetChild[]) => {
        const nextChildren = updater(overlayChildrenRef.current);
        overlayChildrenRef.current = nextChildren;
        setTransientOverlayChildren(nextChildren);

        if (!onOverlayChildrenChange) {
          setInternalOverlayChildren(nextChildren);
        }
      },
      [onOverlayChildrenChange]
    );

    const updateSnappedTextBoxRectsLocally = useCallback(
      (nextColumnWidths: Map<string, number>, nextRowHeights: Map<number, number>) => {
        const nextChildren = syncSnappedTextBoxRects(
          overlayChildrenRef.current,
          nextColumnWidths,
          nextRowHeights
        );

        if (nextChildren === overlayChildrenRef.current) {
          return;
        }

        overlayChildrenRef.current = nextChildren;
        pendingSnappedTextBoxLayoutCommitRef.current = true;
        setTransientOverlayChildren(nextChildren);

        if (!onOverlayChildrenChange) {
          setInternalOverlayChildren(nextChildren);
        }
      },
      [onOverlayChildrenChange]
    );

    const commitSnappedTextBoxRects = useCallback(
      (nextColumnWidths: Map<string, number>, nextRowHeights: Map<number, number>) => {
        const nextChildren = syncSnappedTextBoxRects(
          overlayChildrenRef.current,
          nextColumnWidths,
          nextRowHeights
        );

        if (nextChildren !== overlayChildrenRef.current) {
          commitOverlayChildren(nextChildren);
          pendingSnappedTextBoxLayoutCommitRef.current = false;
          return;
        }

        if (pendingSnappedTextBoxLayoutCommitRef.current) {
          commitOverlayChildren(overlayChildrenRef.current);
          pendingSnappedTextBoxLayoutCommitRef.current = false;
        }
      },
      [commitOverlayChildren]
    );

    const updateColumnWidthsLocally = useCallback(
      (updater: (columnWidths: Map<string, number>) => Map<string, number>) => {
        const nextColumnWidths = updater(columnWidthsRef.current);
        columnWidthsRef.current = nextColumnWidths;
        setTransientColumnWidths(nextColumnWidths);
        updateSnappedTextBoxRectsLocally(nextColumnWidths, rowHeightsRef.current);

        if (!onColumnWidthsChange) {
          setInternalColumnWidths(nextColumnWidths);
        }
      },
      [onColumnWidthsChange, updateSnappedTextBoxRectsLocally]
    );

    const commitColumnWidths = useCallback(
      (nextColumnWidths: Map<string, number>) => {
        columnWidthsRef.current = nextColumnWidths;

        if (onColumnWidthsChange) {
          onColumnWidthsChange(columnWidthsMapToRecord(nextColumnWidths));
          setTransientColumnWidths(nextColumnWidths);
          commitSnappedTextBoxRects(nextColumnWidths, rowHeightsRef.current);
          return;
        }

        setInternalColumnWidths(nextColumnWidths);
        setTransientColumnWidths(null);
        commitSnappedTextBoxRects(nextColumnWidths, rowHeightsRef.current);
      },
      [commitSnappedTextBoxRects, onColumnWidthsChange]
    );

    const updateRowHeightsLocally = useCallback(
      (updater: (rowHeights: Map<number, number>) => Map<number, number>) => {
        const nextRowHeights = updater(rowHeightsRef.current);
        rowHeightsRef.current = nextRowHeights;
        setTransientRowHeights(nextRowHeights);
        updateSnappedTextBoxRectsLocally(columnWidthsRef.current, nextRowHeights);

        if (!onRowHeightsChange) {
          setInternalRowHeights(nextRowHeights);
        }
      },
      [onRowHeightsChange, updateSnappedTextBoxRectsLocally]
    );

    const commitRowHeights = useCallback(
      (nextRowHeights: Map<number, number>) => {
        rowHeightsRef.current = nextRowHeights;

        if (onRowHeightsChange) {
          onRowHeightsChange(rowHeightsMapToRecord(nextRowHeights));
          setTransientRowHeights(nextRowHeights);
          commitSnappedTextBoxRects(columnWidthsRef.current, nextRowHeights);
          return;
        }

        setInternalRowHeights(nextRowHeights);
        setTransientRowHeights(null);
        commitSnappedTextBoxRects(columnWidthsRef.current, nextRowHeights);
      },
      [commitSnappedTextBoxRects, onRowHeightsChange]
    );

    // Handle column resize
    const handleColumnResizeStart = useCallback(
      (e: React.MouseEvent, col: string) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizingColumn(col);
        setResizeStartX(e.clientX);
        setResizeStartSize(getColumnWidth(col));
      },
      [getColumnWidth]
    );

    // Handle row resize
    const handleRowResizeStart = useCallback(
      (e: React.MouseEvent, row: number) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizingRow(row);
        setResizeStartY(e.clientY);
        setResizeStartSize(getRowHeight(row));
      },
      [getRowHeight]
    );

    // Handle resize move
    const handleResizeMove = useCallback(
      (e: MouseEvent) => {
        if (isResizingColumn) {
          const delta = e.clientX - resizeStartX;
          const newWidth = Math.max(20, resizeStartSize + delta / viewport.zoom);
          updateColumnWidthsLocally((prev) => new Map(prev).set(isResizingColumn, newWidth));
        } else if (isResizingRow !== null) {
          const delta = e.clientY - resizeStartY;
          const newHeight = Math.max(20, resizeStartSize + delta / viewport.zoom);
          updateRowHeightsLocally((prev) => new Map(prev).set(isResizingRow, newHeight));
        }
      },
      [
        isResizingColumn,
        isResizingRow,
        resizeStartX,
        resizeStartY,
        resizeStartSize,
        updateColumnWidthsLocally,
        updateRowHeightsLocally,
        viewport.zoom
      ]
    );

    // Handle resize end
    const handleResizeEnd = useCallback(() => {
      if (isResizingColumn) {
        commitColumnWidths(columnWidthsRef.current);
      }
      if (isResizingRow !== null) {
        commitRowHeights(rowHeightsRef.current);
      }
      setIsResizingColumn(null);
      setIsResizingRow(null);
    }, [commitColumnWidths, commitRowHeights, isResizingColumn, isResizingRow]);

    // Handle resize double click (auto-fit)
    const handleColumnResizeDoubleClick = useCallback(
      (e: React.MouseEvent, col: string) => {
        e.preventDefault();
        e.stopPropagation();

        const { viewport, gridDims, height, cellData } = effectsRef.current;

        // Measure all visible cells in the column
        let maxWidth = 50; // Minimum width

        // Check visible cells
        const startRow = Math.max(0, Math.floor(viewport.scrollY / gridDims.cellHeight));
        const endRow = Math.ceil((viewport.scrollY + height) / gridDims.cellHeight) + 1;

        for (let row = startRow; row <= endRow; row++) {
          const cellKey = `${col}${getRowNumber(row)}`;
          const content = cellData.get(cellKey) ?? '';
          if (content) {
            // Estimate text width (rough approximation)
            const estimatedWidth = String(content).length * 8 + 20; // 8px per char + padding
            maxWidth = Math.max(maxWidth, estimatedWidth);
          }
        }

        commitColumnWidths(new Map(columnWidthsRef.current).set(col, maxWidth));
      },
      [commitColumnWidths]
    );

    // Handle resize double click for rows
    const handleRowResizeDoubleClick = useCallback(
      (e: React.MouseEvent, row: number) => {
        e.preventDefault();
        e.stopPropagation();

        // For simplicity, set to a reasonable height
        // In a real implementation, you'd measure the content
        commitRowHeights(new Map(rowHeightsRef.current).set(row, DEFAULT_CELL_HEIGHT));
      },
      [commitRowHeights]
    );

    const commitCurrentOverlayChildren = useCallback(() => {
      overlayInteractionDraftRectsRef.current = {};
      commitOverlayChildren(overlayChildrenRef.current);
    }, [commitOverlayChildren]);

    const setSelectedOverlay = useCallback(
      (childId: string | null) => {
        if (onOverlaySelect) {
          onOverlaySelect(childId);
        }
        setInternalSelectedOverlayId(childId);
      },
      [onOverlaySelect]
    );

    const handleOverlayClick = useCallback(
      (childId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        // Only allow overlay selection if parent is selected
        if (!parentSelected) {
          return;
        }
        // Blur the SelectionManager when selecting an overlay
        selectionManager.blur();
        setSelectedOverlay(childId);
      },
      [setSelectedOverlay, selectionManager, parentSelected]
    );

    const handleOverlayBackgroundClick = useCallback(() => {
      setSelectedOverlay(null);
    }, [setSelectedOverlay]);

    const getOverlayInteractionDraftRect = useCallback((child: SpreadsheetChild): CellSnapRect => {
      const currentDraft = overlayInteractionDraftRectsRef.current[child.id];
      if (currentDraft) {
        return currentDraft;
      }

      const draft = {
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height
      };
      overlayInteractionDraftRectsRef.current[child.id] = draft;
      return draft;
    }, []);

    const handleOverlayMove = useCallback(
      (childId: string, deltaX: number, deltaY: number) => {
        updateOverlayChildrenLocally((children) =>
          children.map((child) => {
            if (child.id !== childId) return child;

            if (isSnappedTextBox(child)) {
              const draft = getOverlayInteractionDraftRect(child);
              draft.x = Math.max(0, draft.x + deltaX);
              draft.y = Math.max(0, draft.y + deltaY);

              const baseAnchor =
                child.cellAnchor ??
                getCellSnapAnchorFromRect(child, columnWidthsRef.current, rowHeightsRef.current);
              const nextAnchor = moveCellSnapAnchorToNearestOrigin(
                baseAnchor,
                draft,
                columnWidthsRef.current,
                rowHeightsRef.current
              );

              return applyCellSnapAnchorToTextBox(
                child,
                nextAnchor,
                columnWidthsRef.current,
                rowHeightsRef.current
              );
            }

            // Constrain overlay position to prevent overlapping with headers
            const newX = Math.max(0, child.x + deltaX);
            const newY = Math.max(0, child.y + deltaY);
            return { ...child, x: newX, y: newY };
          })
        );
      },
      [getOverlayInteractionDraftRect, updateOverlayChildrenLocally]
    );

    const handleOverlayResize = useCallback(
      (childId: string, deltaWidth: number, deltaHeight: number, shiftKey: boolean, handle: string) => {
        updateOverlayChildrenLocally((children) =>
          children.map((child) => {
            if (child.id !== childId) return child;

            if (isSnappedTextBox(child) && isCellSnapResizeHandle(handle)) {
              const draft = getOverlayInteractionDraftRect(child);
              let nextX = draft.x;
              let nextY = draft.y;
              let nextWidth = draft.width;
              let nextHeight = draft.height;

              if (handle === 'left' || handle === 'top-left' || handle === 'bottom-left') {
                nextX = draft.x - deltaWidth;
                nextWidth = draft.width + deltaWidth;
              }
              if (handle === 'right' || handle === 'top-right' || handle === 'bottom-right') {
                nextWidth = draft.width + deltaWidth;
              }
              if (handle === 'top' || handle === 'top-left' || handle === 'top-right') {
                nextY = draft.y - deltaHeight;
                nextHeight = draft.height + deltaHeight;
              }
              if (handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right') {
                nextHeight = draft.height + deltaHeight;
              }

              if (nextX < 0) {
                nextWidth += nextX;
                nextX = 0;
              }
              if (nextY < 0) {
                nextHeight += nextY;
                nextY = 0;
              }

              draft.x = nextX;
              draft.y = nextY;
              draft.width = Math.max(1, nextWidth);
              draft.height = Math.max(1, nextHeight);

              const baseAnchor =
                child.cellAnchor ??
                getCellSnapAnchorFromRect(child, columnWidthsRef.current, rowHeightsRef.current);
              const nextAnchor = resizeCellSnapAnchorToNearestEdges(
                baseAnchor,
                draft,
                handle,
                columnWidthsRef.current,
                rowHeightsRef.current
              );

              return applyCellSnapAnchorToTextBox(
                child,
                nextAnchor,
                columnWidthsRef.current,
                rowHeightsRef.current
              );
            }

            if (shiftKey && (deltaWidth !== 0 || deltaHeight !== 0)) {
              // Locked aspect ratio mode - adjust zoom
              const currentZoom = child.zoom || 1;
              const currentVisualWidth = child.width;
              const currentVisualHeight = child.height;

              const widthScale = deltaWidth !== 0 ? 1 + deltaWidth / currentVisualWidth : 1;
              const heightScale = deltaHeight !== 0 ? 1 + deltaHeight / currentVisualHeight : 1;

              let scaleDelta: number;
              if (handle.includes('-')) {
                scaleDelta = Math.abs(widthScale - 1) > Math.abs(heightScale - 1) ? widthScale : heightScale;
              } else if (handle === 'left' || handle === 'right') {
                scaleDelta = widthScale;
              } else if (handle === 'top' || handle === 'bottom') {
                scaleDelta = heightScale;
              } else {
                scaleDelta = Math.max(widthScale, heightScale);
              }

              const newZoom = currentZoom * scaleDelta;
              const newWidth = child.width * scaleDelta;
              const newHeight = child.height * scaleDelta;
              const deltaX = newWidth - child.width;
              const deltaY = newHeight - child.height;

              let newX = child.x;
              let newY = child.y;
              if (handle === 'left' || handle === 'bottom-left') {
                newX = child.x - deltaX;
              }
              if (handle === 'top' || handle === 'top-right') {
                newY = child.y - deltaY;
              }
              if (handle === 'top-left') {
                newX = child.x - deltaX;
                newY = child.y - deltaY;
              }

              // Constrain overlay position to prevent overlapping with headers
              newX = Math.max(0, newX);
              newY = Math.max(0, newY);

              return {
                ...child,
                x: newX,
                y: newY,
                width: newWidth,
                height: newHeight,
                zoom: newZoom
              };
            } else {
              // Normal resize mode
              let newX = child.x;
              let newY = child.y;
              if (handle === 'left' || handle === 'bottom-left') {
                newX = child.x - deltaWidth;
              }
              if (handle === 'top' || handle === 'top-right') {
                newY = child.y - deltaHeight;
              }
              if (handle === 'top-left') {
                newX = child.x - deltaWidth;
                newY = child.y - deltaHeight;
              }

              // Constrain overlay position to prevent overlapping with headers
              newX = Math.max(0, newX);
              newY = Math.max(0, newY);

              return {
                ...child,
                x: newX,
                y: newY,
                width: child.width + deltaWidth,
                height: child.height + deltaHeight,
                zoom: child.zoom
              };
            }
          })
        );
      },
      [getOverlayInteractionDraftRect, updateOverlayChildrenLocally]
    );

    const handleOverlaySnapToCellsToggle = useCallback(
      (childId: string, enabled: boolean) => {
        overlayInteractionDraftRectsRef.current = {};
        commitOverlayChildren(
          overlayChildrenRef.current.map((child) => {
            if (child.id !== childId || child.component !== 'RichText') {
              return child;
            }

            if (!enabled) {
              return {
                ...child,
                snapToCells: false,
                cellAnchor: undefined
              };
            }

            const anchor = getCellSnapAnchorFromRect(child, columnWidthsRef.current, rowHeightsRef.current);

            return applyCellSnapAnchorToTextBox(
              child,
              anchor,
              columnWidthsRef.current,
              rowHeightsRef.current
            );
          })
        );
      },
      [commitOverlayChildren]
    );

    const handleOverlayReset = useCallback(
      (childId: string) => {
        commitOverlayChildren(
          overlayChildrenRef.current.map((child) => {
            if (child.id !== childId || !child.initial) return child;
            return {
              ...child,
              x: child.initial.x,
              y: child.initial.y,
              width: child.initial.width,
              height: child.initial.height,
              zoom: child.initial.zoom || 1,
              minimized: false
            };
          })
        );
      },
      [commitOverlayChildren]
    );

    const handleOverlayMinimize = useCallback(
      (childId: string) => {
        commitOverlayChildren(
          overlayChildrenRef.current.map((child) =>
            child.id === childId && child.component !== 'RichText'
              ? { ...child, minimized: !child.minimized }
              : child
          )
        );
      },
      [commitOverlayChildren]
    );

    const handleOverlayClose = useCallback(
      (childId: string) => {
        commitOverlayChildren(overlayChildrenRef.current.filter((child) => child.id !== childId));
      },
      [commitOverlayChildren]
    );

    useEffect(() => {
      const handleOverlayDeleteKeyDown = (event: KeyboardEvent) => {
        if (!selectedOverlayId || (event.key !== 'Backspace' && event.key !== 'Delete')) {
          return;
        }

        if (isEditableKeyboardTarget(event.target)) {
          return;
        }

        const selectedOverlay = overlayChildrenRef.current.find((child) => child.id === selectedOverlayId);
        if (selectedOverlay?.component !== 'RichText') {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setSelectedOverlay(null);
        handleOverlayClose(selectedOverlayId);
      };

      document.addEventListener('keydown', handleOverlayDeleteKeyDown);

      return () => {
        document.removeEventListener('keydown', handleOverlayDeleteKeyDown);
      };
    }, [handleOverlayClose, selectedOverlayId, setSelectedOverlay]);

    // Effects
    useEffect(() => {
      drawGrid();
    }, [drawGrid]);

    // Handle resize mouse events
    useEffect(() => {
      if (isResizingColumn || isResizingRow !== null) {
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = isResizingColumn ? 'col-resize' : 'row-resize';

        return () => {
          document.removeEventListener('mousemove', handleResizeMove);
          document.removeEventListener('mouseup', handleResizeEnd);
          document.body.style.cursor = '';
        };
      }
    }, [isResizingColumn, isResizingRow, handleResizeMove, handleResizeEnd]);

    // Handle editing state changes and additional keypress events
    useEffect(() => {
      const editingCleanup = selectionManager.observeStateChange(
        (state) => state.isEditing.type,
        (type) => {
          if (type !== 'none') {
            // When editing, set up additional event handlers for paste, etc.
            const handleEditingKeydown = (e: KeyboardEvent) => {
              // Handle paste during editing
              if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                // Let the browser handle paste into the input naturally
                return;
              }

              // Handle delete/backspace during editing
              if (e.key === 'Delete' || e.key === 'Backspace') {
                // Let the browser handle these naturally in the input
                return;
              }
            };

            window.addEventListener('keydown', handleEditingKeydown);
            return () => {
              window.removeEventListener('keydown', handleEditingKeydown);
            };
          }
        },
        true
      );

      return editingCleanup;
    }, [selectionManager]);

    // Listen to SelectionManager focus changes - deselect overlays when cells gain focus
    React.useEffect(() => {
      return selectionManager.observeStateChange(
        (state) => state.hasFocus,
        (hasFocus) => {
          if (hasFocus && selectedOverlayId) {
            // SelectionManager gained focus, deselect overlay
            setSelectedOverlay(null);
          }
        }
      );
    }, [selectionManager, selectedOverlayId, setSelectedOverlay]);

    // Get visible column headers (just the column info, no positions)
    const getVisibleColumnHeaders = useCallback(() => {
      if (!width) return [];

      const headers: { col: string; colIndex: number }[] = [];
      let x = 0;
      let startCol = 0;

      // Find the first visible column
      while (x < viewport.scrollX) {
        const col = indexToColumn(startCol);
        const colWidth = getColumnWidth(col) * viewport.zoom;
        if (x + colWidth > viewport.scrollX) {
          break;
        }
        x += colWidth;
        startCol++;
      }

      // Collect visible columns
      while (x < viewport.scrollX + width) {
        const col = indexToColumn(startCol);
        const colWidth = getColumnWidth(col) * viewport.zoom;
        headers.push({
          col,
          colIndex: startCol
        });
        x += colWidth;
        startCol++;
      }

      return headers;
    }, [width, viewport, getColumnWidth]);

    // Get visible row headers (just the row info, no positions)
    const getVisibleRowHeaders = useCallback(() => {
      if (!height) return [];

      const headers: { row: number; rowIndex: number }[] = [];
      let y = 0;
      let rowNum = 1;

      // Find the first visible row
      while (y < viewport.scrollY) {
        const rowHeight = getRowHeight(rowNum) * viewport.zoom;
        if (y + rowHeight > viewport.scrollY) {
          break;
        }
        y += rowHeight;
        rowNum++;
      }

      // Collect visible rows
      while (y < viewport.scrollY + height) {
        const rowHeight = getRowHeight(rowNum) * viewport.zoom;
        headers.push({
          row: rowNum,
          rowIndex: rowNum - 1
        });
        y += rowHeight;
        rowNum++;
      }

      return headers;
    }, [height, viewport, getRowHeight]);

    // Get visible overlays with culling and persistent tracking
    const { visibleOverlays, overlaysToRender } = useMemo(() => {
      if (!width || !height || !overlayChildren) {
        return { visibleOverlays: [], overlaysToRender: [] };
      }

      const visible: SpreadsheetChild[] = [];
      const toRender: SpreadsheetChild[] = [];
      const newMountedPersistentIds = new Set(mountedPersistentOverlayIds);

      overlayChildren.forEach((child) => {
        // Calculate child's bounds in screen coordinates
        const childLeft = child.x * viewport.zoom - viewport.scrollX + gridDims.headerWidth;
        const childTop = child.y * viewport.zoom - viewport.scrollY + gridDims.headerHeight;
        const childRight = childLeft + child.width * viewport.zoom;
        const childBottom = childTop + child.height * viewport.zoom;

        // Calculate viewport bounds with margin
        const margin = 100;
        const viewportLeft = gridDims.headerWidth - margin;
        const viewportTop = gridDims.headerHeight - margin;
        const viewportRight = width + margin;
        const viewportBottom = height + margin;

        // Check if overlay is within viewport
        const isVisible =
          childRight >= viewportLeft &&
          childLeft <= viewportRight &&
          childBottom >= viewportTop &&
          childTop <= viewportBottom;

        if (isVisible) {
          visible.push(child);
          toRender.push(child);
          if (child.persistent) {
            newMountedPersistentIds.add(child.id);
          }
        } else if (child.persistent && mountedPersistentOverlayIds.has(child.id)) {
          // Persistent child that was previously mounted but is now invisible
          toRender.push(child);
        }
      });

      // Update mounted persistent children if changed
      if (
        newMountedPersistentIds.size !== mountedPersistentOverlayIds.size ||
        [...newMountedPersistentIds].some((id) => !mountedPersistentOverlayIds.has(id))
      ) {
        setMountedPersistentOverlayIds(newMountedPersistentIds);
      }

      return { visibleOverlays: visible, overlaysToRender: toRender };
    }, [
      overlayChildren,
      viewport.zoom,
      viewport.scrollX,
      viewport.scrollY,
      width,
      height,
      gridDims.headerWidth,
      gridDims.headerHeight,
      mountedPersistentOverlayIds
    ]);

    // Render visible cells
    const visibleCells = React.useMemo(() => getVisibleCells(), [getVisibleCells]);
    const visibleColumnHeaders = React.useMemo(() => getVisibleColumnHeaders(), [getVisibleColumnHeaders]);
    const visibleRowHeaders = React.useMemo(() => getVisibleRowHeaders(), [getVisibleRowHeaders]);

    const hasFocus = useSelectionManager(selectionManager, () => selectionManager.hasFocus);

    // Add wheel handler to container
    React.useEffect(() => {
      if (!containerDivRef || !hasFocus || !parentSelected) {
        return;
      }
      containerDivRef.addEventListener('wheel', handleWheel, {
        passive: false
      });
      return () => {
        containerDivRef.removeEventListener('wheel', handleWheel);
      };
    }, [containerDivRef, handleWheel, hasFocus, parentSelected]);

    // Forward ref
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          selectionManager.focus();
        },
        blur: () => {
          selectionManager.blur();
        }
      }),
      [selectionManager]
    );

    return (
      <div
        className={cn('rsp-root', className)}
        // A stylesheet cannot read an ancestor's `color-scheme`, so the resolved
        // value is reflected here to drive the light/dark token switch.
        data-rsp-scheme={colorScheme}
        style={{ position: 'relative', ...style }}
        {...containerProps}
      >
        <div style={{ position: 'absolute', inset: 0 }} ref={containerRef}>
          {Boolean(width && height) && (
            <div
              ref={setContainerDivRef}
              className={cn('rsp-container', { 'rsp-focused': hasFocus })}
              data-testid="spreadsheet-container"
              style={{
                width,
                height
              }}
              tabIndex={0}
            >
              {/* Resolves the themed gridline color for the canvas. Kept in the
                  DOM (not `display: none`) so the value stays computable. */}
              <span
                ref={gridLineProbeRef}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  width: 0,
                  height: 0,
                  visibility: 'hidden',
                  pointerEvents: 'none',
                  color: 'var(--_rsp-gridline)'
                }}
              />

              <canvas
                ref={canvasRef}
                className="rsp-canvas"
                data-testid="spreadsheet-canvas"
                style={{ width, height }}
              />

              {/* Column headers */}
              <div
                className="rsp-column-headers"
                data-testid="spreadsheet-column-headers"
                style={{
                  left: gridDims.headerWidth,
                  right: 0,
                  height: gridDims.headerHeight,
                  zIndex: 20
                }}
              >
                <div
                  style={{
                    transform: `translateX(${-viewport.scrollX}px) scale(${viewport.zoom})`,
                    transformOrigin: '0 0'
                  }}
                >
                  {visibleColumnHeaders.map(({ col, colIndex }) => {
                    return (
                      <HeaderComponent
                        key={col}
                        index={colIndex}
                        type="col"
                        selectionManager={selectionManager}
                        getColumnWidth={getColumnWidth}
                        getRowHeight={getRowHeight}
                        handleColumnResizeStart={handleColumnResizeStart}
                        handleColumnResizeDoubleClick={handleColumnResizeDoubleClick}
                        handleRowResizeStart={handleRowResizeStart}
                        handleRowResizeDoubleClick={handleRowResizeDoubleClick}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Row headers */}
              <div
                className="rsp-row-headers"
                data-testid="spreadsheet-row-headers"
                style={{
                  top: gridDims.headerHeight,
                  bottom: 0,
                  width: gridDims.headerWidth,
                  zIndex: 20
                }}
              >
                <div
                  style={{
                    transform: `translateY(${-viewport.scrollY}px) scale(${viewport.zoom})`,
                    transformOrigin: '0 0'
                  }}
                >
                  {visibleRowHeaders.map(({ row, rowIndex }) => {
                    return (
                      <HeaderComponent
                        key={row}
                        index={rowIndex}
                        type="row"
                        selectionManager={selectionManager}
                        getColumnWidth={getColumnWidth}
                        getRowHeight={getRowHeight}
                        handleColumnResizeStart={handleColumnResizeStart}
                        handleColumnResizeDoubleClick={handleColumnResizeDoubleClick}
                        handleRowResizeStart={handleRowResizeStart}
                        handleRowResizeDoubleClick={handleRowResizeDoubleClick}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Corner header */}
              <div
                className="rsp-corner-header"
                data-testid="spreadsheet-corner-header"
                style={{
                  width: gridDims.headerWidth,
                  height: gridDims.headerHeight,
                  zIndex: 40
                }}
              />

              <div
                className="rsp-cells"
                data-testid="spreadsheet-cells"
                style={{
                  transform: `translate(${-viewport.scrollX}px, ${-viewport.scrollY}px) scale(${viewport.zoom})`,
                  transformOrigin: '0 0'
                }}
              >
                {visibleCells.map((cell) => (
                  <CellComponent
                    key={`${cell.col}${cell.row}`}
                    value={cellData.get(`${cell.col}${cell.row}`) ?? ''}
                    row={cell.row}
                    col={cell.col}
                    selectionManager={selectionManager}
                    cellToPixelBase={cellToPixelBase}
                    getColumnWidth={getColumnWidth}
                    getRowHeight={getRowHeight}
                    customCellStyle={customCellStyle}
                    customCellRenderer={customCellRenderer}
                    inputValue={cellData.get(`${cell.col}${cell.row}`) ?? ''}
                    editInputVersion={
                      retryingEdit?.rowIndex === cell.row - 1 &&
                      retryingEdit?.colIndex === columnToIndex(cell.col)
                        ? retryingEdit.version
                        : 0
                    }
                    width={width}
                    height={height}
                  />
                ))}
              </div>

              {/* Overlay components layer */}
              {components && overlayChildren && overlayChildren.length > 0 && (
                <div
                  ref={overlayContainerRef}
                  className="rsp-overlays"
                  data-testid="spreadsheet-overlays"
                  onClick={handleOverlayBackgroundClick}
                >
                  {overlaysToRender.map((child) => {
                    const isChildVisible = visibleOverlays.includes(child);
                    const isSelected = selectedOverlayId === child.id;
                    const childZoom = child.zoom || 1;
                    const isTextBox = child.component === 'RichText';
                    const isMinimized = Boolean(child.minimized && !isTextBox);

                    return (
                      <div
                        key={child.id}
                        style={{
                          position: 'absolute',
                          width: child.width,
                          height: isMinimized ? 0 : child.height,
                          transform: `translate(${
                            child.x * viewport.zoom - viewport.scrollX + gridDims.headerWidth
                          }px, ${
                            child.y * viewport.zoom - viewport.scrollY + gridDims.headerHeight
                          }px) scale(${viewport.zoom})`,
                          transformOrigin: '0 0',
                          display: isChildVisible ? 'block' : 'none',
                          pointerEvents: 'auto',
                          zIndex: isSelected ? 50 : 5
                        }}
                        onClick={(e) => handleOverlayClick(child.id, e)}
                      >
                        <Frame
                          child={child}
                          isSelected={isSelected}
                          zoom={viewport.zoom}
                          viewport$={viewportStreamRef.current}
                          onMove={(dx, dy) => handleOverlayMove(child.id, dx, dy)}
                          onResize={(dw, dh, shift, handle) =>
                            handleOverlayResize(child.id, dw, dh, shift, handle)
                          }
                          onSnapToCellsToggle={(enabled) => handleOverlaySnapToCellsToggle(child.id, enabled)}
                          onReset={() => handleOverlayReset(child.id)}
                          onMinimize={() => handleOverlayMinimize(child.id)}
                          onClose={() => handleOverlayClose(child.id)}
                          onInteractionEnd={commitCurrentOverlayChildren}
                        />
                        {!isMinimized && (
                          <div
                            style={{
                              transform: childZoom !== 1 ? `scale(${childZoom})` : undefined,
                              transformOrigin: '0 0',
                              width: child.width / childZoom,
                              height: child.height / childZoom,
                              position: 'absolute',
                              overflow: 'hidden',
                              top: 0,
                              left: 0
                            }}
                          >
                            {components[child.component]?.(child, {
                              isSelected,
                              isMinimized: !!child.minimized
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Placeholder for overlay placement */}
                  {overlayPlaceholder && placeholderPos && (
                    <div
                      className="rsp-overlay-placeholder"
                      style={{
                        width: overlayPlaceholder.width,
                        height: overlayPlaceholder.height,
                        transform: `translate(${
                          placeholderPos.x * viewport.zoom - viewport.scrollX + gridDims.headerWidth
                        }px, ${
                          placeholderPos.y * viewport.zoom - viewport.scrollY + gridDims.headerHeight
                        }px) scale(${viewport.zoom})`,
                        transformOrigin: '0 0'
                      }}
                    >
                      <div className="rsp-overlay-placeholder-label">
                        {overlayPlaceholder.title}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

Spreadsheet.displayName = 'Spreadsheet';
