import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from './constants';
import { indexToColumn } from './utils';

export interface CellSnapAnchor {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface CellSnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CellSnapResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const normalizeCellSnapAnchor = (anchor: CellSnapAnchor): CellSnapAnchor => {
  const startCol = Math.max(0, Math.floor(anchor.startCol));
  const startRow = Math.max(0, Math.floor(anchor.startRow));

  return {
    startCol,
    startRow,
    endCol: Math.max(startCol + 1, Math.floor(anchor.endCol)),
    endRow: Math.max(startRow + 1, Math.floor(anchor.endRow))
  };
};

const getColumnWidthByIndex = (colIndex: number, columnWidths: Map<string, number>): number => {
  const width = columnWidths.get(indexToColumn(colIndex));
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : DEFAULT_CELL_WIDTH;
};

const getRowHeightByIndex = (rowIndex: number, rowHeights: Map<number, number>): number => {
  const height = rowHeights.get(rowIndex + 1);
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : DEFAULT_CELL_HEIGHT;
};

export const getColumnEdgePosition = (edgeIndex: number, columnWidths: Map<string, number>): number => {
  const safeEdgeIndex = Math.max(0, Math.floor(edgeIndex));
  let x = 0;

  for (let colIndex = 0; colIndex < safeEdgeIndex; colIndex++) {
    x += getColumnWidthByIndex(colIndex, columnWidths);
  }

  return x;
};

export const getRowEdgePosition = (edgeIndex: number, rowHeights: Map<number, number>): number => {
  const safeEdgeIndex = Math.max(0, Math.floor(edgeIndex));
  let y = 0;

  for (let rowIndex = 0; rowIndex < safeEdgeIndex; rowIndex++) {
    y += getRowHeightByIndex(rowIndex, rowHeights);
  }

  return y;
};

export const getNearestColumnEdgeIndex = (x: number, columnWidths: Map<string, number>): number => {
  const targetX = Math.max(0, x);
  let edgeIndex = 0;
  let currentX = 0;

  while (true) {
    const nextX = currentX + getColumnWidthByIndex(edgeIndex, columnWidths);
    if (targetX <= nextX) {
      return targetX - currentX <= nextX - targetX ? edgeIndex : edgeIndex + 1;
    }

    currentX = nextX;
    edgeIndex++;
  }
};

export const getNearestRowEdgeIndex = (y: number, rowHeights: Map<number, number>): number => {
  const targetY = Math.max(0, y);
  let edgeIndex = 0;
  let currentY = 0;

  while (true) {
    const nextY = currentY + getRowHeightByIndex(edgeIndex, rowHeights);
    if (targetY <= nextY) {
      return targetY - currentY <= nextY - targetY ? edgeIndex : edgeIndex + 1;
    }

    currentY = nextY;
    edgeIndex++;
  }
};

export const getCellSnapAnchorFromRect = (
  rect: CellSnapRect,
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): CellSnapAnchor => {
  const startCol = getNearestColumnEdgeIndex(rect.x, columnWidths);
  const startRow = getNearestRowEdgeIndex(rect.y, rowHeights);
  const endCol = getNearestColumnEdgeIndex(rect.x + Math.max(0, rect.width), columnWidths);
  const endRow = getNearestRowEdgeIndex(rect.y + Math.max(0, rect.height), rowHeights);

  return normalizeCellSnapAnchor({
    startCol,
    startRow,
    endCol,
    endRow
  });
};

export const getRectFromCellSnapAnchor = (
  anchor: CellSnapAnchor,
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): CellSnapRect => {
  const normalizedAnchor = normalizeCellSnapAnchor(anchor);
  const x = getColumnEdgePosition(normalizedAnchor.startCol, columnWidths);
  const y = getRowEdgePosition(normalizedAnchor.startRow, rowHeights);
  const right = getColumnEdgePosition(normalizedAnchor.endCol, columnWidths);
  const bottom = getRowEdgePosition(normalizedAnchor.endRow, rowHeights);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
};

export const moveCellSnapAnchorToNearestOrigin = (
  anchor: CellSnapAnchor,
  rect: CellSnapRect,
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): CellSnapAnchor => {
  const normalizedAnchor = normalizeCellSnapAnchor(anchor);
  const colSpan = normalizedAnchor.endCol - normalizedAnchor.startCol;
  const rowSpan = normalizedAnchor.endRow - normalizedAnchor.startRow;
  const startCol = getNearestColumnEdgeIndex(rect.x, columnWidths);
  const startRow = getNearestRowEdgeIndex(rect.y, rowHeights);

  return {
    startCol,
    startRow,
    endCol: startCol + colSpan,
    endRow: startRow + rowSpan
  };
};

const handleIncludesLeft = (handle: CellSnapResizeHandle): boolean =>
  handle === 'left' || handle === 'top-left' || handle === 'bottom-left';

const handleIncludesRight = (handle: CellSnapResizeHandle): boolean =>
  handle === 'right' || handle === 'top-right' || handle === 'bottom-right';

const handleIncludesTop = (handle: CellSnapResizeHandle): boolean =>
  handle === 'top' || handle === 'top-left' || handle === 'top-right';

const handleIncludesBottom = (handle: CellSnapResizeHandle): boolean =>
  handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right';

export const resizeCellSnapAnchorToNearestEdges = (
  anchor: CellSnapAnchor,
  rect: CellSnapRect,
  handle: CellSnapResizeHandle,
  columnWidths: Map<string, number>,
  rowHeights: Map<number, number>
): CellSnapAnchor => {
  const nextAnchor = normalizeCellSnapAnchor(anchor);

  if (handleIncludesLeft(handle)) {
    nextAnchor.startCol = getNearestColumnEdgeIndex(rect.x, columnWidths);
  }
  if (handleIncludesRight(handle)) {
    nextAnchor.endCol = getNearestColumnEdgeIndex(rect.x + Math.max(0, rect.width), columnWidths);
  }
  if (handleIncludesTop(handle)) {
    nextAnchor.startRow = getNearestRowEdgeIndex(rect.y, rowHeights);
  }
  if (handleIncludesBottom(handle)) {
    nextAnchor.endRow = getNearestRowEdgeIndex(rect.y + Math.max(0, rect.height), rowHeights);
  }

  if (nextAnchor.startCol >= nextAnchor.endCol) {
    if (handleIncludesLeft(handle) && !handleIncludesRight(handle)) {
      nextAnchor.startCol = Math.max(0, nextAnchor.endCol - 1);
    } else {
      nextAnchor.endCol = nextAnchor.startCol + 1;
    }
  }

  if (nextAnchor.startRow >= nextAnchor.endRow) {
    if (handleIncludesTop(handle) && !handleIncludesBottom(handle)) {
      nextAnchor.startRow = Math.max(0, nextAnchor.endRow - 1);
    } else {
      nextAnchor.endRow = nextAnchor.startRow + 1;
    }
  }

  return nextAnchor;
};
