// Column utilities
export const columnToIndex = (col: string): number => {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64); // A=1, B=2, etc.
  }
  return result - 1; // Convert to 0-based index
};

export const indexToColumn = (index: number): string => {
  let result = '';
  let num = index + 1; // Convert to 1-based

  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }

  return result;
};

export function getRowNumber(index: number): number {
  return index + 1;
}

export function getCellReference({ rowIndex, colIndex }: { rowIndex: number; colIndex: number }) {
  return `${indexToColumn(colIndex)}${getRowNumber(rowIndex)}`;
}

// Convert row number to letter(s) for reversed headers (1 -> A, 2 -> B, etc.)
export function rowToLetter(row: number): string {
  let result = '';
  let num = row - 1; // Convert to 0-based

  do {
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);

  return result;
}

// Convert letter(s) to row number for reversed headers (A -> 1, B -> 2, etc.)
export function letterToRow(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result;
}

export const parseCellReference = (
  cellReference: string
): {
  column: string;
  row: number;
  columnIndex: number;
  rowIndex: number;
} => {
  const match = cellReference.match(/^([A-Z]+)(\d+)$/);
  const column = match?.[1];
  const rowText = match?.[2];

  if (!column || !rowText) {
    throw new Error(`Invalid cell reference: ${cellReference}`);
  }

  const row = parseInt(rowText, 10);
  const columnIndex = columnToIndex(column);
  const rowIndex = row - 1; // Convert to 0-based index

  return {
    column,
    row,
    columnIndex,
    rowIndex
  };
};

export function findCell(
  map: Map<string, string | number>,
  search: string
):
  | {
      cellReference: string;
      column: string;
      row: number;
      columnIndex: number;
      rowIndex: number;
    }
  | undefined {
  for (const [key, cell] of map) {
    if (cell === search) {
      const parsed = parseCellReference(key);
      if (!parsed) {
        return undefined;
      }

      return {
        cellReference: cell,
        ...parsed
      };
    }
  }
}

/**
 * Returns the values that belong to the column whose header equals `header`,
 * in strict top-to-bottom order (H2, H3, H4 …).
 */
export function extractColumnByHeader(
  map: Map<string, string | number>,
  header: string
): (string | number)[] {
  for (const [cell, value] of map) {
    if (value === header) {
      const parsed = parseCellReference(cell);
      if (!parsed) {
        return [];
      }

      return extractColumn(map, parsed.columnIndex, parsed.rowIndex + 1);
    }
  }

  return [];
}

export function extractColumn(
  map: Map<string, string | number>,
  colIndex: number,
  rowIndex = 0,
  handleEmpty?: (rowIndex: number) => string | number
): (string | number)[] {
  // ── 2. Gather rows in the same column, paired with their row numbers ───────
  const rows: [number, string | number][] = [];

  for (const [cell, value] of map) {
    const parsed = parseCellReference(cell);
    if (!parsed) continue;

    if (parsed.columnIndex === colIndex && parsed.rowIndex >= rowIndex) {
      rows.push([parsed.rowIndex, value]);
    }
  }

  // ── 3. Sort by the numeric row index ─────────────────────────────────────────
  rows.sort((a, b) => a[0] - b[0]); // top → bottom

  // ── 4. If no handleEmpty function, return simple mapping ────────────────────
  if (!handleEmpty) {
    return rows.map(([, value]) => value); // just the cell contents
  }

  // ── 5. Fill gaps using handleEmpty function ─────────────────────────────────
  if (rows.length === 0) {
    return []; // No data found, return empty array
  }

  const result: (string | number)[] = [];
  const lastRow = rows[rows.length - 1];
  if (!lastRow) {
    return [];
  }
  const maxRowIndex = lastRow[0]; // Last row index in sorted array
  const rowMap = new Map(rows); // Map row index to value for quick lookup

  // Fill from starting rowIndex to maxRowIndex, filling gaps as needed
  for (let currentRow = rowIndex; currentRow <= maxRowIndex; currentRow++) {
    if (rowMap.has(currentRow)) {
      result.push(rowMap.get(currentRow)!);
    } else {
      result.push(handleEmpty(currentRow));
    }
  }

  return result;
}
