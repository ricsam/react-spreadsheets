import { afterEach, beforeAll, expect, mock, spyOn, test } from 'bun:test';
import { FormulaEngine, type SerializedCellValue } from '@ricsam/formula-engine';
import type { SelectionManager } from '@ricsam/selection-manager';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FormulaSheet } from './workbook';

const sheet = { workbookName: 'Book', sheetName: 'Sheet1' };
const address = (colIndex: number, rowIndex = 0) => ({ ...sheet, colIndex, rowIndex });
let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 400, 300) } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  mock.restore();
});
async function mount(content: Map<string, SerializedCellValue>, setup?: (engine: FormulaEngine) => void) {
  const engine = FormulaEngine.buildEmpty();
  engine.addWorkbook({ workbookName: 'Book' });
  engine.addSheet(sheet);
  engine.setSheetContent(sheet, content);
  setup?.(engine);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  let manager!: SelectionManager;
  const errors: unknown[] = [];
  await act(async () => root.render(<FormulaSheet engine={engine} {...sheet}
    onCellDataChangeError={error => errors.push(error)}
    selection={{ effects: value => { manager = value; } }} />));
  engine.clearUndoRedoHistory();
  return { engine, manager, errors };
}

test('inline Enter commits one cell without sheet replacement or global cache invalidation', async () => {
  const { engine, manager } = await mount(new Map<string, SerializedCellValue>([
    ['A1', 2], ['B1', '=A1*2'], ['Z100', '=SUM(20,22)']
  ]));
  expect(engine.getCellValue(address(25, 99))).toBe(42);
  const warm = engine._evaluationManager.getCellEvaluationResult(address(25, 99));
  const replace = spyOn(engine, 'setSheetContent');
  const reset = spyOn(engine, 'clearCache');
  const clear = spyOn(engine._evaluationManager, 'clearEvaluationCache');
  const dependencyClear = spyOn(engine._dependencyManager, 'clearEvaluationCache');
  const invalidate = spyOn(engine._dependencyManager, 'invalidateEvaluationCache');
  const writes = spyOn(engine, 'setCellContent');
  const types = spyOn(engine, 'getCellDataType');
  await act(async () => manager.editCell(0, 0));
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Edit A1"]')!;
  input.value = '3';
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(types).toHaveBeenCalledTimes(1);
  for (const spy of [replace, reset, clear, dependencyClear, invalidate]) expect(spy).not.toHaveBeenCalled();
  expect(engine.getCellValue(address(1))).toBe(6);
  expect(engine._evaluationManager.getCellEvaluationResult(address(25, 99))).toBe(warm);
  expect(engine.getCellValue(address(25, 99))).toBe(42);
  expect(engine._evaluationManager.getCellEvaluationResult(address(25, 99))).toBe(warm);
  await act(async () => { expect(engine.undo()).toBe(true); });
  expect(engine.getCellValue(address(0))).toBe(2);
  expect(engine.canUndo()).toBe(false);
});

test('bulk patches coerce only changed cells, clear values, and undo/redo atomically', async () => {
  const { engine, manager } = await mount(new Map<string, SerializedCellValue>([
    ['A1', 'old'], ['B1', 10], ['C1', false], ['D1', 'remove'], ['Z100', '123']
  ]), engine => {
    for (const [col, dataType] of [[0, 'text'], [1, 'number'], [2, 'boolean']] as const) {
      engine.addCellDataType({ dataType, areas: [{ ...sheet, range: {
        start: { col, row: 0 }, end: { col: { type: 'number', value: col }, row: { type: 'number', value: 0 } }
      } }] });
    }
  });
  const updates: number[] = [];
  engine.onUpdate(() => updates.push(1));
  await act(async () => manager.saveCellValues([
    { rowIndex: 0, colIndex: 0, value: '007' },
    { rowIndex: 0, colIndex: 1, value: '1,5' },
    { rowIndex: 0, colIndex: 2, value: 'yes' },
    { rowIndex: 0, colIndex: 3, value: '' },
    { rowIndex: 0, colIndex: 4, value: '=B1*2' }
  ]));
  expect(updates).toHaveLength(1);
  expect(engine.getSheetSerialized(sheet).get('A1')).toBe('007');
  expect(engine.getCellValue(address(1))).toBe(1.5);
  expect(engine.getCellValue(address(2))).toBe(true);
  expect(engine.getSheetSerialized(sheet).has('D1')).toBe(false);
  expect(engine.getCellValue(address(4))).toBe(3);
  expect(engine.getSheetSerialized(sheet).get('Z100')).toBe('123');
  await act(async () => { expect(engine.undo()).toBe(true); });
  expect(engine.getCellValue(address(1))).toBe(10);
  expect(engine.getCellValue(address(3))).toBe('remove');
  expect(engine.canUndo()).toBe(false);
  await act(async () => { expect(engine.redo()).toBe(true); });
  expect(engine.getCellValue(address(1))).toBe(1.5);
});

test('failed multi-cell patch rolls back prior writes and table renames without an undo entry', async () => {
  const { engine, manager, errors } = await mount(new Map<string, SerializedCellValue>([
    ['A1', 'Name'], ['B1', 'Value'], ['A2', 'original']
  ]), engine => engine.addTable({ ...sheet, tableName: 'Data', start: 'A1', numCols: 2, numRows: { type: 'number', value: 1 } }));
  spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => manager.saveCellValues([
    { rowIndex: 1, colIndex: 0, value: 'changed' },
    { rowIndex: 0, colIndex: 0, value: 'Renamed' },
    { rowIndex: 0, colIndex: 1, value: 'Renamed' }
  ]));
  expect(errors).toEqual([new Error('Duplicate table header "Renamed"')]);
  expect(engine.getCellValue(address(0, 1))).toBe('original');
  expect(engine.getCellValue(address(0))).toBe('Name');
  expect(engine.getTable({ workbookName: 'Book', tableName: 'Data' })?.headers.has('Name')).toBe(true);
  expect(engine.canUndo()).toBe(false);
});
