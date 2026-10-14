import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { FormulaEngine } from '@ricsam/formula-engine';
import type { SelectionManager } from '@ricsam/selection-manager';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FormulaSheet, WorkbookSelectionManager } from './workbook';

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: new DOMRectReadOnly(0, 0, 400, 300)
        } as ResizeObserverEntry
      ],
      this
    );
  }

  disconnect(): void {}
  unobserve(): void {}
}

describe('FormulaSheet custom cell styles', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(() => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: TestResizeObserver
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = undefined;
    container = undefined;
  });

  test('applies consumer styles to ordinary cells outside tables', async () => {
    const engine = FormulaEngine.buildEmpty();
    engine.addWorkbook('Book');
    engine.addSheet({ workbookName: 'Book', sheetName: 'Sheet1' });
    engine.setSheetContent(
      { workbookName: 'Book', sheetName: 'Sheet1' },
      new Map([['A1', 42]])
    );
    engine.addCellStyle({
      areas: [
        {
          workbookName: 'Book',
          sheetName: 'Sheet1',
          range: {
            start: { col: 0, row: 0 },
            end: {
              col: { type: 'number', value: 0 },
              row: { type: 'number', value: 0 }
            }
          }
        }
      ],
      style: { bold: true, color: '#1d4ed8' }
    });

    const styledCells: string[] = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <FormulaSheet
          engine={engine}
          workbookName="Book"
          sheetName="Sheet1"
          aria-label="Book Sheet1"
          customCellStyle={(cell, internalStyle) => {
            styledCells.push(cell.id);
            return cell.id === 'A1'
              ? { ...internalStyle, backgroundColor: '#fef08a' }
              : internalStyle;
          }}
        />
      );
    });

    const cell = document.querySelector<HTMLElement>('[data-testid="spreadsheet-cell-A1"]');
    expect(document.querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe('Book Sheet1');
    expect(cell?.getAttribute('role')).toBe('gridcell');
    expect(cell?.textContent).toBe('42');
    expect(styledCells).toContain('A1');
    expect(cell?.style.backgroundColor).toBe('#fef08a');
    expect(cell?.style.color).toBe('#1d4ed8');
    expect(cell?.style.fontWeight).toBe('bold');
  });

  test('shares style reads and only renders changed selection cells; engine updates invalidate', async () => {
    const engine = FormulaEngine.buildEmpty();
    engine.addWorkbook('Book');
    const address = { workbookName: 'Book', sheetName: 'Sheet1' };
    engine.addSheet(address);
    engine.setSheetContent(address, new Map([['A1', 1]]));
    const manager = new WorkbookSelectionManager();
    const styled: string[] = [], rendered: string[] = [];
    const reads = spyOn(engine, 'getCellStyle');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <FormulaSheet engine={engine} {...address} selectionManager={manager}
        customCellStyle={(cell, style) => {
          styled.push(cell.id);
          return { ...style, opacity: cell.isSelected ? 0.8 : 1 };
        }}
        customCellRenderer={(cell, element) => { rendered.push(cell.id); return element; }}
      />
    ));
    const visible = container.querySelectorAll('[role="gridcell"]').length;
    expect(reads.mock.calls.length).toBe(visible);
    const focus = async (row: number, col: number) => act(async () => {
      manager.focusRange({ ...address, range: { start: { row, col }, end: {
        row: { type: 'number', value: row }, col: { type: 'number', value: col }
      } } });
    });
    await focus(0, 0);
    styled.length = 0;
    rendered.length = 0;
    reads.mockClear();
    await focus(1, 1);
    expect(new Set(styled)).toEqual(new Set(['A1', 'B2']));
    expect(new Set(rendered)).toEqual(new Set(['A1', 'B2']));
    expect(reads.mock.calls.length).toBe(0);
    const cell = (id: string) => container!.querySelector<HTMLElement>(`[data-cell-address="${id}"]`)!;
    expect(cell('A1').getAttribute('aria-selected')).toBe('false');
    expect(cell('B2').getAttribute('aria-selected')).toBe('true');
    expect(cell('B2').style.opacity).toBe('0.8');
    await act(async () => engine.setSheetContent(address, new Map([['A1', 99]])));
    expect(cell('A1').textContent).toBe('99');
    expect(reads.mock.calls.length).toBe(visible);
    reads.mockClear();
    await act(async () => engine.setWorkbookMetadata('Book', {
      defaultCellStyle: { fontSize: 16, fontFamily: 'Arial', bold: true, color: '#000000' }
    }));
    expect(cell('A1').style.fontSize).toBe('16px');
    expect(cell('A1').style.fontFamily).toBe('Arial');
    expect(reads.mock.calls.length).toBe(visible);
    await act(async () => engine.addCellStyle({ areas: [{ ...address, range: {
      start: { row: 0, col: 0 }, end: {
        row: { type: 'number', value: 0 }, col: { type: 'number', value: 0 }
      }
    } }], style: { fontSize: 12, bold: false, color: '#ff0000' } }));
    expect(cell('A1').style.fontSize).toBe('12px');
    expect(cell('A1').style.fontWeight).toBe('normal');
    expect(cell('A1').style.color).toBe('#ff0000');
    expect(cell('B2').style.fontSize).toBe('16px');
    // Styles may depend on other sheets even when this sheet's content is unchanged.
    await act(async () => engine.addSheet({ workbookName: 'Book', sheetName: 'Inputs' }));
    reads.mockImplementation(() => ({ color: engine.getCellValue({
      workbookName: 'Book', sheetName: 'Inputs', rowIndex: 0, colIndex: 0
    }) === 1 ? '#00ff00' : '#0000ff' }));
    await act(async () => engine.setSheetContent(
      { workbookName: 'Book', sheetName: 'Inputs' }, new Map([['A1', 1]])
    ));
    expect(cell('A1').style.color).toBe('#00ff00');
    await act(async () => engine.setSheetContent(
      { workbookName: 'Book', sheetName: 'Inputs' }, new Map([['A1', 2]])
    ));
    expect(cell('A1').style.color).toBe('#0000ff');
    await act(async () => engine.undo());
    expect(cell('A1').style.color).toBe('#00ff00');
    await act(async () => engine.redo());
    expect(cell('A1').style.color).toBe('#0000ff');
    reads.mockRestore();
  });

  test('repaints a programmatic range selection when the grid is already focused', async () => {
    const engine = FormulaEngine.buildEmpty();
    engine.addWorkbook('Book');
    engine.addSheet({ workbookName: 'Book', sheetName: 'Sheet1' });
    const workbookSelection = new WorkbookSelectionManager();
    let sheetSelection: SelectionManager | undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <FormulaSheet
          engine={engine}
          workbookName="Book"
          sheetName="Sheet1"
          selectionManager={workbookSelection}
          selection={{
            initialState: {
              selections: [
                {
                  start: { row: 0, col: 0 },
                  end: {
                    row: { type: 'number', value: 0 },
                    col: { type: 'number', value: 0 }
                  }
                }
              ]
            },
            effects: (manager) => {
              sheetSelection = manager;
            }
          }}
        />
      );
    });

    if (!sheetSelection) throw new Error('Expected sheet SelectionManager');
    await act(async () => sheetSelection?.focus());
    expect(
      document.querySelector('[data-testid="spreadsheet-cell-A1"]')?.classList.contains('rsp-cell-selected')
    ).toBe(true);

    await act(async () => {
      workbookSelection.focusRange({
        workbookName: 'Book',
        sheetName: 'Sheet1',
        range: {
          start: { row: 1, col: 1 },
          end: {
            row: { type: 'number', value: 1 },
            col: { type: 'number', value: 1 }
          }
        }
      });
    });

    expect(
      document.querySelector('[data-testid="spreadsheet-cell-A1"]')?.classList.contains('rsp-cell-selected')
    ).toBe(false);
    expect(
      document.querySelector('[data-testid="spreadsheet-cell-B2"]')?.classList.contains('rsp-cell-selected')
    ).toBe(true);
  });
});
