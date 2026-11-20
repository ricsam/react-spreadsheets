import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { SelectionManager } from '@ricsam/selection-manager';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ClipboardUtils } from '../clipboard/clipboard-manager';
import { DEFAULT_CELL_HEIGHT } from './constants';
import { Spreadsheet } from './spreadsheet';

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: new DOMRectReadOnly(0, 0, 500, 400) } as ResizeObserverEntry],
      this
    );
  }
  disconnect(): void {}
  unobserve(): void {}
}

const finite = (value: number) => ({ type: 'number' as const, value });
const area = (startRow: number, startCol: number, endRow: number, endCol: number) => ({
  start: { row: startRow, col: startCol },
  end: { row: finite(endRow), col: finite(endCol) }
});
const cellData = new Map<string, string | number>([
  ['A1', 'a'],
  ['B1', 1],
  ['A2', 'b'],
  ['B2', 2],
  ['A3', 'c'],
  ['B3', 3],
  ['A4', 'd'],
  ['B4', 4],
  ['A5', 'e']
]);

describe('hidden rows', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: TestResizeObserver });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  const render = async (node: React.ReactNode) => {
    if (!container) {
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(node));
  };
  const cell = (address: string) =>
    document.querySelector<HTMLElement>(`[data-cell-address="${address}"]`);
  const rowHeader = (row: number) =>
    document.querySelector<HTMLElement>(`[data-testid="spreadsheet-row-header-${row}"]`);

  test('take no height, render no cells or headers and mark the next row header', async () => {
    let manager: SelectionManager | undefined;
    const sheet = (hiddenRows?: ReadonlySet<number>) => (
      <Spreadsheet
        rowCount={8}
        columnCount={2}
        cellData={cellData}
        hiddenRows={hiddenRows}
        selection={{
          initialState: { selections: [area(0, 0, 0, 0)] },
          effects: (value) => {
            manager = value;
          }
        }}
      />
    );
    await render(sheet(new Set([1, 2])));

    expect(cell('A2')).toBeNull();
    expect(cell('B3')).toBeNull();
    expect(cell('A4')?.textContent).toBe('d');
    expect(parseFloat(cell('A4')!.style.top) - parseFloat(cell('A1')!.style.top)).toBe(
      DEFAULT_CELL_HEIGHT
    );
    expect(rowHeader(2)).toBeNull();
    expect(rowHeader(3)).toBeNull();
    expect(rowHeader(4)?.classList.contains('rsp-header-after-hidden')).toBe(true);
    expect(rowHeader(5)?.classList.contains('rsp-header-after-hidden')).toBe(false);
    expect(manager?.getHiddenRows()).toEqual(new Set([1, 2]));

    // Arrow keys step over the hidden rows.
    await act(async () => {
      manager?.handleKeyDown({
        key: 'ArrowDown',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: mock(() => {})
      });
    });
    expect(manager?.selections.at(-1)).toEqual(area(3, 0, 3, 0));

    // A new set shows the rows again, at their full height.
    await render(sheet(new Set()));
    expect(cell('A2')?.textContent).toBe('b');
    expect(rowHeader(4)?.classList.contains('rsp-header-after-hidden')).toBe(false);
    expect(parseFloat(cell('A4')!.style.top) - parseFloat(cell('A1')!.style.top)).toBe(
      DEFAULT_CELL_HEIGHT * 3
    );
  });

  test('Cmd+Arrow jumps treat the next shown row as the neighbour', async () => {
    let manager: SelectionManager | undefined;
    await render(
      <Spreadsheet
        rowCount={20}
        columnCount={2}
        cellData={new Map([
          ['A1', 'x'],
          ['A2', 'x'],
          ['A5', 'x'],
          ['A6', 'x'],
          ['A10', 'x']
        ])}
        hiddenRows={new Set([2, 3])}
        selection={{
          initialState: { selections: [area(0, 0, 0, 0)] },
          effects: (value) => {
            manager = value;
          }
        }}
      />
    );
    const jumpDown = () =>
      act(async () => {
        manager?.handleKeyDown({
          key: 'ArrowDown',
          shiftKey: false,
          ctrlKey: false,
          metaKey: true,
          preventDefault: mock(() => {})
        });
      });
    // Rows 3 and 4 are hidden, so A1, A2, A5 and A6 are one block.
    await jumpDown();
    expect(manager?.selections.at(-1)).toEqual(area(5, 0, 5, 0));
    await jumpDown();
    expect(manager?.selections.at(-1)).toEqual(area(9, 0, 9, 0));
  });

  test('copies leave hidden rows out and record which rows they hold', () => {
    const manager = new SelectionManager(
      () => finite(20),
      () => finite(5),
      () => [],
      { hiddenRows: [1, 2] }
    );
    manager.replaceSelections([area(0, 0, 4, 1)]);
    const extracted = new ClipboardUtils().extractCellsFromSelection(manager, cellData)!;
    expect(extracted.width).toBe(2);
    expect(extracted.height).toBe(3);
    expect(extracted.origin).toEqual({ rowIndex: 0, columnIndex: 0 });
    expect(extracted.rows).toEqual([0, 3, 4]);
    expect(
      extracted.cells.map(({ relative, absolute }) => [
        relative.rowIndex,
        relative.columnIndex,
        absolute.rowIndex
      ])
    ).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 3],
      [1, 1, 3],
      [2, 0, 4]
    ]);

    manager.setHiddenRows([]);
    expect(new ClipboardUtils().extractCellsFromSelection(manager, cellData)!.rows).toEqual([
      0, 1, 2, 3, 4
    ]);
  });
});
