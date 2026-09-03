import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
    expect(styledCells).toContain('A1');
    expect(cell?.style.backgroundColor).toBe('#fef08a');
    expect(cell?.style.color).toBe('#1d4ed8');
    expect(cell?.style.fontWeight).toBe('bold');
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
