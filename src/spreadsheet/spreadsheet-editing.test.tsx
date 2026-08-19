import { afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { FormulaEngine } from '@ricsam/formula-engine';
import type { SelectionManager } from '@ricsam/selection-manager';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Spreadsheet } from './spreadsheet';

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

describe('spreadsheet editing', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = undefined;
    container = undefined;
    mock.restore();
  });

  test('reopens a rejected inline edit with its draft so it can be corrected', async () => {
    globalThis.ResizeObserver = TestResizeObserver;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    let selectionManager: SelectionManager | undefined;
    const submittedValues: string[] = [];
    const errors: unknown[] = [];
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const engine = FormulaEngine.buildEmpty();
    engine.addWorkbook('Book');
    engine.addSheet({ workbookName: 'Book', sheetName: 'Sheet1' });
    engine.setSheetContent(
      { workbookName: 'Book', sheetName: 'Sheet1' },
      new Map([
        ['A1', 'Name'],
        ['B1', 'Value']
      ])
    );
    engine.addTable({
      tableName: 'Data',
      workbookName: 'Book',
      sheetName: 'Sheet1',
      start: 'A1',
      numRows: { type: 'number', value: 0 },
      numCols: 2
    });

    await act(async () => {
      root?.render(
        <Spreadsheet
          style={{ width: 400, height: 300 }}
          cellData={engine.getSheetSerialized({ workbookName: 'Book', sheetName: 'Sheet1' })}
          onCellDataChange={(data) => {
            const value = String(data.get('B1') ?? '');
            submittedValues.push(value);
            engine.setSheetContent({ workbookName: 'Book', sheetName: 'Sheet1' }, data);
          }}
          onCellDataChangeError={(error) => errors.push(error)}
          selection={{
            effects: (manager) => {
              selectionManager = manager;
            }
          }}
        />
      );
    });

    if (!selectionManager) throw new Error('Expected selection manager');

    await act(async () => selectionManager?.editCell(0, 1));
    const firstInput = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="spreadsheet-cell-input-B1"]'
    );
    if (!firstInput) throw new Error('Expected inline editor');
    firstInput.value = 'Name';
    const rejectedEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    });

    await act(async () => {
      firstInput.dispatchEvent(rejectedEnter);
      await Promise.resolve();
    });

    expect(rejectedEnter.defaultPrevented).toBe(true);
    const retriedInput = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="spreadsheet-cell-input-B1"]'
    );
    expect(retriedInput).not.toBeNull();
    expect(retriedInput).not.toBe(firstInput);
    expect(retriedInput?.value).toBe('Name');
    expect(selectionManager.isEditingCell(0, 1)).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(new Error('Duplicate table header "Name"'));
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(engine.getTable({ workbookName: 'Book', tableName: 'Data' })?.headers.has('Value')).toBe(true);

    if (!retriedInput) throw new Error('Expected retried inline editor');
    retriedInput.value = 'Unique';
    await act(async () => {
      retriedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(submittedValues).toEqual(['Name', 'Unique']);
    expect(selectionManager.isEditingCell(0, 1)).toBe(false);
    expect(engine.getTable({ workbookName: 'Book', tableName: 'Data' })?.headers.get('Unique')).toEqual({
      name: 'Unique',
      index: 1
    });
  });
});
