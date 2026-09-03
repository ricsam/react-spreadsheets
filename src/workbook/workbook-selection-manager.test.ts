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
  sheetName = 'Sheet1'
): RangeAddress => ({
  workbookName,
  sheetName,
  range: {
    start: { row: 8, col: 2 },
    end: {
      row: { type: 'number', value: 14 },
      col: { type: 'number', value: 5 }
    }
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
});
