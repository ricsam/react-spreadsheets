import type { RangeAddress } from '@ricsam/formula-engine';
import { SelectionManager, type ViewportRequest } from '@ricsam/selection-manager';
import { describe, expect, test } from 'bun:test';
import { WorkbookSelectionManager } from './workbook-selection-manager';

const createSelectionManager = () =>
  new SelectionManager(
    () => ({ type: 'number', value: 100 }),
    () => ({ type: 'number', value: 50 }),
    () => []
  );

const rangeAddress = (
  workbookName = 'Workbook1',
  sheetName = 'Sheet1',
  startRow = 8,
  startCol = 2,
  endRow = 14,
  endCol = 5
): RangeAddress => ({
  workbookName,
  sheetName,
  range: {
    start: { row: startRow, col: startCol },
    end: {
      row: { type: 'number', value: endRow },
      col: { type: 'number', value: endCol }
    }
  }
});

const finiteArea = (
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
) => ({
  start: { row: startRow, col: startCol },
  end: {
    row: { type: 'number' as const, value: endRow },
    col: { type: 'number' as const, value: endCol }
  }
});

describe('WorkbookSelectionManager range focus', () => {
  test('focuses, selects and reveals a range on a mounted sheet', () => {
    const workbookManager = new WorkbookSelectionManager();
    const manager = createSelectionManager();
    const viewportRequests: ViewportRequest[] = [];
    manager.listenToViewportRequest((request) => viewportRequests.push(request));
    workbookManager.add(manager, { workbookName: 'Workbook1', sheetName: 'Sheet1' });

    const address = rangeAddress();
    expect(workbookManager.focusRange(address, { align: 'start' })).toBe(true);

    expect(manager.hasFocus).toBe(true);
    expect(manager.selections).toEqual([
      {
        start: { row: 8, col: 2 },
        end: {
          row: { type: 'number', value: 14 },
          col: { type: 'number', value: 5 }
        }
      }
    ]);
    expect(viewportRequests).toEqual([
      {
        type: 'reveal-range',
        range: manager.selections[0]!,
        align: 'start',
        reason: 'programmatic'
      }
    ]);
    expect(workbookManager.getLastSelection()).toEqual(address);
  });

  test('notifies selection subscribers when the target grid is already focused', () => {
    const workbookManager = new WorkbookSelectionManager();
    const manager = createSelectionManager();
    manager.focus();
    workbookManager.add(manager, { workbookName: 'Workbook1', sheetName: 'Sheet1' });

    const managerNotifications: unknown[] = [];
    const workbookNotifications: RangeAddress[][] = [];
    manager.observeStateChange(
      (state) => state.selections,
      (selections) => {
        managerNotifications.push(selections);
      }
    );
    workbookManager.onSelectionChange((selections) => workbookNotifications.push(selections));

    const address = rangeAddress();
    workbookManager.focusRange(address);

    expect(managerNotifications).toEqual([[finiteArea(8, 2, 14, 5)]]);
    expect(workbookNotifications).toEqual([[address]]);
  });

  test('targets one of two mounted copies by stable viewId', () => {
    const workbookManager = new WorkbookSelectionManager();
    const left = createSelectionManager();
    const right = createSelectionManager();
    const leftRequests: ViewportRequest[] = [];
    const rightRequests: ViewportRequest[] = [];
    left.replaceSelections([finiteArea(1, 1, 1, 1)]);
    right.replaceSelections([finiteArea(2, 2, 2, 2)]);
    left.listenToViewportRequest((request) => leftRequests.push(request));
    right.listenToViewportRequest((request) => rightRequests.push(request));
    workbookManager.add(left, {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'left-pane'
    });
    workbookManager.add(right, {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'right-pane'
    });

    const address = rangeAddress('Workbook1', 'Sheet1', 20, 3, 24, 6);
    expect(workbookManager.focusRange(address, { viewId: 'right-pane' })).toBe(true);

    expect(left.selections).toEqual([finiteArea(1, 1, 1, 1)]);
    expect(leftRequests).toEqual([]);
    expect(left.hasFocus).toBe(false);
    expect(right.selections).toEqual([finiteArea(20, 3, 24, 6)]);
    expect(rightRequests).toEqual([
      {
        type: 'reveal-range',
        range: finiteArea(20, 3, 24, 6),
        align: 'nearest',
        reason: 'programmatic'
      }
    ]);
    expect(right.hasFocus).toBe(true);
    expect(workbookManager.getLastFocusedSelectionManager()?.context.viewId).toBe('right-pane');
  });

  test('keeps remount selection caches isolated by viewId', () => {
    const workbookManager = new WorkbookSelectionManager();
    const firstLeft = createSelectionManager();
    const firstRight = createSelectionManager();
    const leftContext = {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'left-pane'
    };
    const rightContext = {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'right-pane'
    };
    const removeLeft = workbookManager.add(firstLeft, leftContext);
    const removeRight = workbookManager.add(firstRight, rightContext);

    firstLeft.replaceSelections([finiteArea(3, 4, 3, 4)]);
    firstRight.replaceSelections([finiteArea(30, 8, 32, 10)]);
    removeLeft();
    removeRight();

    const remountedRight = createSelectionManager();
    const remountedLeft = createSelectionManager();
    workbookManager.add(remountedRight, rightContext);
    workbookManager.add(remountedLeft, leftContext);

    expect(remountedLeft.selections).toEqual([finiteArea(3, 4, 3, 4)]);
    expect(remountedRight.selections).toEqual([finiteArea(30, 8, 32, 10)]);
  });

  test('does not let the wrong duplicate view consume a queued focus request', async () => {
    const workbookManager = new WorkbookSelectionManager();
    const address = rangeAddress('Workbook1', 'Sheet1', 12, 4, 18, 7);
    expect(workbookManager.focusRange(address, { viewId: 'right-pane' })).toBe(false);

    const left = createSelectionManager();
    const leftRequests: ViewportRequest[] = [];
    left.listenToViewportRequest((request) => leftRequests.push(request));
    workbookManager.add(left, {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'left-pane'
    });
    await Promise.resolve();
    expect(left.selections).toEqual([]);
    expect(leftRequests).toEqual([]);

    const right = createSelectionManager();
    const rightRequests: ViewportRequest[] = [];
    right.listenToViewportRequest((request) => rightRequests.push(request));
    workbookManager.add(right, {
      workbookName: 'Workbook1',
      sheetName: 'Sheet1',
      viewId: 'right-pane'
    });
    await Promise.resolve();

    expect(right.selections).toEqual([finiteArea(12, 4, 18, 7)]);
    expect(rightRequests).toHaveLength(1);
  });

  test('queues the latest range until its target sheet mounts', async () => {
    const workbookManager = new WorkbookSelectionManager();
    const firstRequest = rangeAddress('Workbook1', 'Pending');
    const latestRequest = rangeAddress('Workbook2', 'Target');

    expect(workbookManager.focusRange(firstRequest)).toBe(false);
    expect(workbookManager.focusRange(latestRequest, { align: 'end' })).toBe(false);

    // Queued requests own their data instead of retaining caller mutations.
    latestRequest.range.start.row = 99;

    const unrelatedManager = createSelectionManager();
    const unrelatedRequests: ViewportRequest[] = [];
    unrelatedManager.listenToViewportRequest((request) => unrelatedRequests.push(request));
    workbookManager.add(unrelatedManager, {
      workbookName: 'Workbook1',
      sheetName: 'Pending'
    });
    await Promise.resolve();
    expect(unrelatedManager.selections).toEqual([]);
    expect(unrelatedRequests).toEqual([]);

    const targetManager = createSelectionManager();
    const targetRequests: ViewportRequest[] = [];
    targetManager.listenToViewportRequest((request) => targetRequests.push(request));
    workbookManager.add(targetManager, {
      workbookName: 'Workbook2',
      sheetName: 'Target'
    });
    await Promise.resolve();

    expect(targetManager.hasFocus).toBe(true);
    expect(targetManager.selections[0]?.start).toEqual({ row: 8, col: 2 });
    expect(targetRequests).toEqual([
      {
        type: 'reveal-range',
        range: targetManager.selections[0]!,
        align: 'end',
        reason: 'programmatic'
      }
    ]);
  });

  test('focusCell uses the range navigation path and can be deferred', async () => {
    const workbookManager = new WorkbookSelectionManager();
    expect(workbookManager.focusCell('Workbook1', 'Later', 7, 4)).toBe(false);

    const manager = createSelectionManager();
    const viewportRequests: ViewportRequest[] = [];
    manager.listenToViewportRequest((request) => viewportRequests.push(request));
    workbookManager.add(manager, { workbookName: 'Workbook1', sheetName: 'Later' });
    await Promise.resolve();

    expect(manager.selections).toEqual([
      {
        start: { row: 7, col: 4 },
        end: {
          row: { type: 'number', value: 7 },
          col: { type: 'number', value: 4 }
        }
      }
    ]);
    expect(viewportRequests).toEqual([
      {
        type: 'reveal-range',
        range: manager.selections[0]!,
        align: 'nearest',
        reason: 'programmatic'
      }
    ]);
  });

  test('can cancel a queued range focus', async () => {
    const workbookManager = new WorkbookSelectionManager();
    expect(workbookManager.focusRange(rangeAddress('Workbook1', 'Later'))).toBe(false);
    workbookManager.cancelPendingFocusRange();

    const manager = createSelectionManager();
    workbookManager.add(manager, { workbookName: 'Workbook1', sheetName: 'Later' });
    await Promise.resolve();

    expect(manager.hasFocus).toBe(false);
    expect(manager.selections).toEqual([]);
  });
});
