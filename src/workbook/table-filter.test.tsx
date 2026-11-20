import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { FormulaEngine, type SerializedCellValue } from '@ricsam/formula-engine';
import { SelectionManager } from '@ricsam/selection-manager';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FormulaSheet, WorkbookClipboardManager, splitVisibleRows } from './workbook';

const sheet = { workbookName: 'Book', sheetName: 'Sheet1' };
const table = { workbookName: 'Book', tableName: 'People' };
const finite = (value: number) => ({ type: 'number' as const, value });
const area = (startRow: number, startCol: number, endRow: number, endCol: number) => ({
  start: { row: startRow, col: startCol },
  end: { row: finite(endRow), col: finite(endCol) }
});

/** People(Name, Group) in A1:B5, with a formula column C beside it. */
function createEngine() {
  const engine = FormulaEngine.buildEmpty();
  engine.addWorkbook({ workbookName: 'Book' });
  engine.addSheet(sheet);
  engine.setSheetContent(
    sheet,
    new Map<string, SerializedCellValue>([
      ['A1', 'Name'],
      ['B1', 'Group'],
      ['A2', 'x'],
      ['B2', 'red'],
      ['C2', '=A2&"!"'],
      ['A3', 'y'],
      ['B3', 'blue'],
      ['C3', '=A3&"!"'],
      ['A4', 'z'],
      ['B4', 'red'],
      ['C4', '=A4&"!"'],
      ['A5', 'w'],
      ['C5', '=A5&"!"']
    ])
  );
  engine.addTable({ ...sheet, tableName: 'People', start: 'A1', numCols: 2, numRows: finite(4) });
  engine.clearUndoRedoHistory();
  return engine;
}

describe('FormulaSheet table sort and filter', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(() => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: new DOMRectReadOnly(0, 0, 500, 400) } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          );
        }
        disconnect() {}
        unobserve() {}
      }
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mount(engine: FormulaEngine) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let manager!: SelectionManager;
    await act(async () =>
      root!.render(
        <FormulaSheet
          engine={engine}
          {...sheet}
          selection={{
            effects: (value) => {
              manager = value;
            }
          }}
        />
      )
    );
    return { manager };
  }
  const cell = (address: string) =>
    container!.querySelector<HTMLElement>(`[data-cell-address="${address}"]`);
  const button = (address: string) =>
    container!.querySelector<HTMLButtonElement>(`[data-rsp-filter-button="${address}"]`);
  const menu = () => container!.querySelector<HTMLElement>('[data-testid="table-filter-menu"]');
  const menuButton = (name: string) =>
    Array.from(menu()!.querySelectorAll('button')).find((element) => element.textContent?.includes(name))!;
  const valueOptions = () =>
    Array.from(menu()!.querySelectorAll<HTMLLabelElement>('.rsp-table-filter-option:not(.rsp-table-filter-option-all)'));
  const click = (element: HTMLElement) => act(async () => element.click());

  test('header buttons open the menu, and each choice is one engine change', async () => {
    const engine = createEngine();
    await mount(engine);
    expect(button('A1')?.getAttribute('aria-label')).toBe('Sort and filter Name');
    expect(button('B1')?.getAttribute('aria-label')).toBe('Sort and filter Group');
    expect(button('C1')).toBeNull();
    expect(button('A2')).toBeNull();

    await click(button('B1')!);
    expect(menu()?.getAttribute('aria-label')).toBe('Sort and filter Group');
    expect(button('B1')?.getAttribute('aria-expanded')).toBe('true');
    expect(
      valueOptions().map((option) => [
        option.querySelector('.rsp-table-filter-option-label')?.textContent,
        option.querySelector('.rsp-table-filter-option-count')?.textContent
      ])
    ).toEqual([
      ['blue', '1'],
      ['red', '2'],
      ['(Blanks)', '1']
    ]);

    const red = valueOptions().find((option) => option.textContent?.startsWith('red'))!;
    await click(red.querySelector('input')!);
    await click(menuButton('OK'));
    expect(menu()).toBeNull();
    expect(engine.getTable(table)?.filter?.columns).toEqual([
      { column: 1, filter: { type: 'values', values: ['blue'], blanks: true } }
    ]);
    expect(cell('A2')).toBeNull();
    expect(cell('A4')).toBeNull();
    expect(cell('A3')?.textContent).toBe('y');
    expect(button('B1')?.getAttribute('data-filtered')).toBe('true');
    expect(button('B1')?.getAttribute('aria-label')).toBe('Sort and filter Group (filtered)');

    await act(async () => {
      expect(engine.undo()).toBe(true);
    });
    expect(engine.canUndo()).toBe(false);
    expect(cell('A2')?.textContent).toBe('x');
    expect(button('B1')?.hasAttribute('data-filtered')).toBe(false);

    await click(button('A1')!);
    await click(menuButton('Sort Z to A'));
    expect(menu()).toBeNull();
    expect(['A2', 'A3', 'A4', 'A5'].map((address) => cell(address)?.textContent)).toEqual([
      'z',
      'y',
      'x',
      'w'
    ]);
    expect(button('A1')?.getAttribute('data-sort')).toBe('descending');

    // Escape closes the menu without changing anything.
    await click(button('B1')!);
    await act(async () => {
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(engine.getTable(table)?.filter).toBeUndefined();
  });

  test('a condition filter hides the rows that fail it', async () => {
    const engine = createEngine();
    await mount(engine);
    await click(button('A1')!);
    const condition = menu()!.querySelector<HTMLSelectElement>('select[aria-label="Condition"]')!;
    const input = menu()!.querySelector<HTMLInputElement>('input[aria-label="Condition value"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setValue.call(condition, 'notEquals');
      condition.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'y');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(menuButton('Apply condition'));
    expect(engine.getTable(table)?.filter).toEqual({
      columns: [{ column: 0, filter: { type: 'condition', conditions: [{ operator: 'notEquals', value: 'y' }] } }],
      hiddenRows: [2]
    });
    expect(cell('A3')).toBeNull();
  });

  test('Alt+Down on a table header cell opens its menu', async () => {
    const engine = createEngine();
    const { manager } = await mount(engine);
    await act(async () => {
      manager.focus();
      manager.replaceSelections([area(0, 1, 0, 1)]);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    });
    expect(menu()?.getAttribute('aria-label')).toBe('Sort and filter Group');
    // The menu took the key: the selection did not move.
    expect(manager.selections.at(-1)).toEqual(area(0, 1, 0, 1));
  });
});

describe('filtered ranges in the workbook clipboard and fills', () => {
  test('a copy of filtered rows pastes them one after another, formulas adjusted', () => {
    const engine = createEngine();
    const source = new SelectionManager(() => finite(100), () => finite(10), () => [], {
      hiddenRows: [2]
    });
    source.replaceSelections([area(1, 0, 4, 2)]);
    const clipboard = new WorkbookClipboardManager(engine);
    clipboard.triggerCopy({ ...sheet, selectionManager: source, copyType: 'value' });
    expect(clipboard.signature).toBe('x\tred\tx!\nz\tred\tz!\nw\t\tw!');
    expect(clipboard.copiedRows).toEqual([1, 3, 4]);

    const target = new SelectionManager(() => finite(100), () => finite(10), () => []);
    target.replaceSelections([area(9, 3, 9, 3)]);
    clipboard.triggerPaste({
      ...sheet,
      selectionManager: target,
      updates: [],
      rawString: clipboard.signature,
      pasteType: 'formula'
    });
    const content = engine.getSheetSerialized(sheet);
    expect([content.get('D10'), content.get('E10'), content.get('F10')]).toEqual(['x', 'red', '=D10&"!"']);
    expect([content.get('D11'), content.get('E11'), content.get('F11')]).toEqual(['z', 'red', '=D11&"!"']);
    expect([content.get('D12'), content.get('F12')]).toEqual(['w', '=D12&"!"']);
    expect(content.has('D13')).toBe(false);
    expect(engine.undo()).toBe(true);
    expect(engine.getSheetSerialized(sheet).has('D10')).toBe(false);
  });

  test('splitVisibleRows returns the runs of shown rows', () => {
    const range = {
      start: { row: 1, col: 2 },
      end: { row: finite(9), col: finite(3) }
    };
    const runs = (hidden: number[]) =>
      splitVisibleRows(range, new Set(hidden)).map((run) => [
        run.start.row,
        run.end.row.type === 'number' ? run.end.row.value : Infinity
      ]);
    expect(runs([])).toEqual([[1, 9]]);
    expect(runs([0, 3, 4, 9, 12])).toEqual([
      [1, 2],
      [5, 8]
    ]);
    expect(runs([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([]);
    const open = { start: { row: 1, col: 0 }, end: { row: { type: 'infinity' as const, sign: 'positive' as const }, col: finite(0) } };
    expect(splitVisibleRows(open, new Set([2]))).toEqual([open]);
  });
});
