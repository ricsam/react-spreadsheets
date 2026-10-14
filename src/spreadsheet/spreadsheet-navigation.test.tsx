import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { SelectionManager } from '@ricsam/selection-manager';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Spreadsheet, type SpreadsheetRef } from './spreadsheet';

let observedSize = { width: 500, height: 300 };

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: new DOMRectReadOnly(
            0,
            0,
            observedSize.width,
            observedSize.height
          )
        } as ResizeObserverEntry
      ],
      this
    );
  }

  disconnect(): void {}
  unobserve(): void {}
}

describe('spreadsheet navigation and reference selection', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeAll(() => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: TestResizeObserver
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    observedSize = { width: 500, height: 300 };
    mock.restore();
  });

  const mount = async (node: React.ReactNode) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(node));
  };

  test('exposes a named virtual grid with logical rows, coordinates and selection', async () => {
    let manager: SelectionManager | undefined;
    await mount(<Spreadsheet aria-label="Budget" rowCount={2} columnCount={3}
      cellData={new Map([['A1', 'Revenue']])}
      selection={{ effects: (value) => { manager = value; } }} />);
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Budget');
    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    expect(grid.getAttribute('aria-colcount')).toBe('4');
    expect(grid.getAttribute('aria-multiselectable')).toBe('true');
    const cell = grid.querySelector('[data-cell-address="A1"]')!;
    expect(cell.getAttribute('role')).toBe('gridcell');
    expect(cell.getAttribute('aria-rowindex')).toBe('2');
    expect(cell.getAttribute('aria-colindex')).toBe('2');
    expect(cell.textContent).toBe('Revenue');
    const row = grid.querySelector('[role="row"][aria-rowindex="2"]')!;
    expect(row.getAttribute('aria-owns')?.split(' ')).toContain(cell.id);
    expect(row.querySelector('[role="rowheader"]')?.textContent).toBe('1');
    expect(grid.querySelector('[role="columnheader"]')?.textContent).toBe('A');
    await act(async () => { grid.focus(); });
    expect(manager?.hasFocus).toBe(true);
    await act(async () => { manager?.replaceSelections([{ start: { row: 0, col: 0 }, end: { row: { type: 'number', value: 0 }, col: { type: 'number', value: 0 } } }]); });
    expect(cell.getAttribute('aria-selected')).toBe('true');
    expect(grid.getAttribute('aria-activedescendant')).toBe(cell.id);
    await act(async () => { manager?.replaceSelections([{ start: { row: 1, col: 1 }, end: { row: { type: 'number', value: 1 }, col: { type: 'number', value: 1 } } }]); });
    expect(cell.getAttribute('aria-selected')).toBe('false');
    expect(grid.querySelector('[data-cell-address="B2"]')?.getAttribute('aria-selected')).toBe('true');
    await act(async () => { manager?.editCell(1, 1); });
    expect(grid.querySelector('textarea[aria-label="Edit B2"]')).not.toBeNull();
    expect(manager?.isEditingCell(1, 1)).toBe(true);
  });

  test('forwards mounted active-cell semantics to capable keyboard capture peers', async () => {
    const updateCapture = mock(() => {});
    let manager: SelectionManager | undefined;
    await mount(<Spreadsheet aria-label="Forecast" aria-describedby="help"
      rowCount={2} columnCount={2}
      selection={{ effects: (value) => {
        manager = value;
        Object.assign(value, { setInputCaptureAccessibility: updateCapture });
      } }} />);
    await act(async () => {
      manager?.replaceSelections([{ start: { row: 1, col: 1 }, end: {
        row: { type: 'number', value: 1 }, col: { type: 'number', value: 1 }
      } }]);
    });
    const grid = document.querySelector('[role="grid"]')!;
    expect(updateCapture).toHaveBeenLastCalledWith({
      label: 'Forecast keyboard input', controls: grid.id,
      activeDescendant: grid.querySelector('[data-cell-address="B2"]')!.id,
      describedBy: 'help'
    });
    await act(async () => root?.unmount());
    root = undefined;
    expect(updateCapture).toHaveBeenLastCalledWith({});
  });

  test('unknown dimensions and duplicate views have safe ARIA identities', async () => {
    await mount(<><Spreadsheet /><Spreadsheet /></>);
    const grids = document.querySelectorAll('[role="grid"]');
    expect(grids.length).toBe(2);
    expect(grids[0]?.getAttribute('aria-rowcount')).toBe('-1');
    expect(grids[0]?.getAttribute('aria-colcount')).toBe('-1');
    const ids = Array.from(document.querySelectorAll('[role="gridcell"]'), (cell) => cell.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('finite row and column counts constrain rendering and selection bounds', async () => {
    await mount(
      <Spreadsheet
        style={{ width: 500, height: 300 }}
        rowCount={2}
        columnCount={3}
      />
    );

    expect(document.querySelector('[data-testid="spreadsheet-cell-A1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="spreadsheet-cell-C2"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="spreadsheet-cell-D1"]')).toBeNull();
    expect(document.querySelector('[data-testid="spreadsheet-cell-A3"]')).toBeNull();
    expect(document.querySelector('[data-testid="spreadsheet-col-header-D"]')).toBeNull();
    expect(document.querySelector('[data-testid="spreadsheet-row-header-3"]')).toBeNull();
  });

  test('Cmd+Arrow uses sparse data and reveals the target with custom dimensions', async () => {
    observedSize = { width: 260, height: 150 };
    let manager: SelectionManager | undefined;

    await mount(
      <Spreadsheet
        style={{ width: 260, height: 150 }}
        rowCount={50}
        columnCount={6}
        cellData={new Map([
          ['D9', 'start'],
          ['D40', 'target']
        ])}
        columnWidths={{ D: 140 }}
        rowHeights={{ 40: 60 }}
        selection={{
          initialState: {
            selections: [
              {
                start: { row: 8, col: 3 },
                end: {
                  row: { type: 'number', value: 8 },
                  col: { type: 'number', value: 3 }
                }
              }
            ]
          },
          effects: (selectionManager) => {
            manager = selectionManager;
          }
        }}
      />
    );

    if (!manager) throw new Error('Expected SelectionManager');
    await act(async () => {
      manager?.handleKeyDown({
        key: 'ArrowDown',
        shiftKey: false,
        ctrlKey: false,
        metaKey: true,
        preventDefault: mock(() => {})
      });
    });

    expect(manager.selections.at(-1)).toEqual({
      start: { row: 39, col: 3 },
      end: {
        row: { type: 'number', value: 39 },
        col: { type: 'number', value: 3 }
      }
    });
    expect(document.querySelector('[data-testid="spreadsheet-cell-D40"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(-230px, -1110px) scale(1)'
    );
  });

  test('scrollToCell reveals without changing the primary selection', async () => {
    observedSize = { width: 260, height: 150 };
    const spreadsheetRef = createRef<SpreadsheetRef>();
    let manager: SelectionManager | undefined;

    await mount(
      <Spreadsheet
        ref={spreadsheetRef}
        style={{ width: 260, height: 150 }}
        rowCount={30}
        columnCount={6}
        columnWidths={{ D: 150 }}
        rowHeights={{ 20: 60 }}
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
          effects: (selectionManager) => {
            manager = selectionManager;
          }
        }}
      />
    );

    await act(async () => spreadsheetRef.current?.scrollToCell({ row: 19, col: 3 }, { align: 'end' }));

    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(-240px, -510px) scale(1)'
    );
    expect(manager?.selections.at(-1)?.start).toEqual({ row: 0, col: 0 });
    expect(document.querySelector('[role="grid"]')?.hasAttribute('aria-activedescendant')).toBe(false);
    for (const row of document.querySelectorAll('[role="row"][aria-owns]')) {
      for (const id of row.getAttribute('aria-owns')!.split(' ')) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });

  test('scrollToRange normalizes reversed ranges and clamps them to finite bounds', async () => {
    observedSize = { width: 260, height: 150 };
    const spreadsheetRef = createRef<SpreadsheetRef>();

    await mount(
      <Spreadsheet
        ref={spreadsheetRef}
        style={{ width: 260, height: 150 }}
        rowCount={30}
        columnCount={6}
      />
    );

    await act(async () =>
      spreadsheetRef.current?.scrollToRange(
        {
          start: { row: 999, col: 999 },
          end: {
            row: { type: 'number', value: 10 },
            col: { type: 'number', value: 1 }
          }
        },
        { align: 'end' }
      )
    );

    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(-390px, -780px) scale(1)'
    );
  });

  test('nearest alignment reveals the closest edge of a range larger than the viewport', async () => {
    observedSize = { width: 260, height: 150 };
    const spreadsheetRef = createRef<SpreadsheetRef>();

    await mount(
      <Spreadsheet
        ref={spreadsheetRef}
        style={{ width: 260, height: 150 }}
        rowCount={30}
        columnCount={6}
      />
    );

    await act(async () =>
      spreadsheetRef.current?.scrollToRange({
        start: { row: 10, col: 1 },
        end: {
          row: { type: 'number', value: 19 },
          col: { type: 'number', value: 3 }
        }
      })
    );

    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(0px, -300px) scale(1)'
    );
  });

  test('selection-manager revealRange clamps open ranges to finite sheet bounds', async () => {
    observedSize = { width: 260, height: 150 };
    let manager: SelectionManager | undefined;

    await mount(
      <Spreadsheet
        style={{ width: 260, height: 150 }}
        rowCount={50}
        columnCount={6}
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
          effects: (selectionManager) => {
            manager = selectionManager;
          }
        }}
      />
    );

    if (!manager) throw new Error('Expected SelectionManager');
    await act(async () =>
      manager?.revealRange(
        {
          start: { row: 40, col: 4 },
          end: {
            row: { type: 'infinity' },
            col: { type: 'infinity' }
          }
        },
        { align: 'end' }
      )
    );

    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(-390px, -1380px) scale(1)'
    );
    expect(manager.selections.at(-1)?.start).toEqual({ row: 0, col: 0 });
  });

  test('open ranges on an unbounded sheet reveal their finite anchor', async () => {
    observedSize = { width: 260, height: 150 };
    const spreadsheetRef = createRef<SpreadsheetRef>();

    await mount(<Spreadsheet ref={spreadsheetRef} style={{ width: 260, height: 150 }} />);

    await act(async () =>
      spreadsheetRef.current?.scrollToRange(
        {
          start: { row: 19, col: 3 },
          end: {
            row: { type: 'infinity' },
            col: { type: 'infinity' }
          }
        },
        { align: 'end' }
      )
    );

    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(-190px, -480px) scale(1)'
    );
  });

  test('wheel scrolling remains available while the selection manager is blurred', async () => {
    observedSize = { width: 260, height: 150 };
    let manager: SelectionManager | undefined;

    await mount(
      <div data-rsp-overlay="outer-spreadsheet-overlay">
        <Spreadsheet
          style={{ width: 260, height: 150 }}
          rowCount={50}
          columnCount={6}
          selection={{
            effects: (selectionManager) => {
              manager = selectionManager;
            }
          }}
        />
      </div>
    );

    if (!manager) throw new Error('Expected SelectionManager');
    await act(async () => {
      manager?.focus();
      manager?.blur();
    });

    const spreadsheet = document.querySelector<HTMLElement>(
      '[data-testid="spreadsheet-container"]'
    );
    if (!spreadsheet) throw new Error('Expected spreadsheet container');

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 90
    });
    await act(async () => {
      spreadsheet.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(0px, -90px) scale(1)'
    );
  });

  test('wheel events inside an overlay remain native and do not move the grid', async () => {
    observedSize = { width: 260, height: 150 };
    let manager: SelectionManager | undefined;

    await mount(
      <Spreadsheet
        style={{ width: 260, height: 150 }}
        rowCount={50}
        columnCount={6}
        components={{
          RichText: () => (
            <div data-testid="scrollable-overlay">
              <div data-testid="scrollable-overlay-content">Scrollable content</div>
            </div>
          )
        }}
        overlayChildren={[
          {
            id: 'notes',
            component: 'RichText',
            title: 'Notes',
            x: 0,
            y: 0,
            width: 160,
            height: 100
          }
        ]}
        selection={{
          effects: (selectionManager) => {
            manager = selectionManager;
          }
        }}
      />
    );

    if (!manager) throw new Error('Expected SelectionManager');
    await act(async () => {
      manager?.focus();
      manager?.blur();
    });

    const overlayContent = document.querySelector<HTMLElement>(
      '[data-testid="scrollable-overlay-content"]'
    );
    if (!overlayContent) throw new Error('Expected scrollable overlay content');
    expect(overlayContent.closest('[data-rsp-overlay]')?.getAttribute('data-rsp-overlay')).toBe(
      'notes'
    );

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 90
    });
    await act(async () => {
      overlayContent.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(0px, 0px) scale(1)'
    );

    const overlayLayer = document.querySelector<HTMLElement>(
      '[data-testid="spreadsheet-overlays"]'
    );
    if (!overlayLayer) throw new Error('Expected overlay layer');
    const layerWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 90
    });
    await act(async () => {
      overlayLayer.dispatchEvent(layerWheelEvent);
    });

    expect(layerWheelEvent.defaultPrevented).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(0px, -90px) scale(1)'
    );
  });

  test('wheel scrolling stays disabled when the parent component is not selected', async () => {
    observedSize = { width: 260, height: 150 };

    await mount(
      <Spreadsheet
        style={{ width: 260, height: 150 }}
        rowCount={50}
        columnCount={6}
        parentSelected={false}
      />
    );

    const spreadsheet = document.querySelector<HTMLElement>(
      '[data-testid="spreadsheet-container"]'
    );
    if (!spreadsheet) throw new Error('Expected spreadsheet container');

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 90
    });
    await act(async () => {
      spreadsheet.dispatchEvent(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-testid="spreadsheet-cells"]')?.style.transform).toBe(
      'translate(0px, 0px) scale(1)'
    );
  });

  test('reverse reference drag renders one overlay around every cell in the rectangle', async () => {
    let manager: SelectionManager | undefined;

    await mount(
      <Spreadsheet
        style={{ width: 500, height: 300 }}
        rowCount={10}
        columnCount={10}
        selection={{
          initialState: {
            selections: [
              {
                start: { row: 0, col: 3 },
                end: {
                  row: { type: 'number', value: 0 },
                  col: { type: 'number', value: 3 }
                }
              }
            ]
          },
          effects: (selectionManager) => {
            manager = selectionManager;
          }
        }}
      />
    );

    if (!manager) throw new Error('Expected SelectionManager');
    await act(async () => {
      manager?.beginReferenceSelection({
        id: 'formula-token-1',
        editedRange: {
          start: { row: 0, col: 3 },
          end: {
            row: { type: 'number', value: 0 },
            col: { type: 'number', value: 3 }
          }
        }
      });
      manager?.cellMouseDown(3, 2, {
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        isFillHandle: false
      });
      manager?.cellMouseEnter(1, 1);
    });

    const overlay = document.querySelector<HTMLElement>(
      '[data-testid="spreadsheet-reference-selection"]'
    );
    if (!overlay) throw new Error('Expected formula reference overlay');

    expect(overlay.dataset.referenceId).toBe('formula-token-1');
    expect(overlay.dataset.referencePhase).toBe('selecting');
    expect(overlay.style.left).toBe('150px');
    expect(overlay.style.top).toBe('60px');
    expect(overlay.style.width).toBe('200px');
    expect(overlay.style.height).toBe('90px');

    const overlayLeft = Number.parseFloat(overlay.style.left);
    const overlayTop = Number.parseFloat(overlay.style.top);
    const overlayRight = overlayLeft + Number.parseFloat(overlay.style.width);
    const overlayBottom = overlayTop + Number.parseFloat(overlay.style.height);

    for (const reference of ['B2', 'B3', 'B4', 'C2', 'C3', 'C4']) {
      const cell = document.querySelector<HTMLElement>(
        `[data-testid="spreadsheet-cell-${reference}"]`
      );
      if (!cell) throw new Error(`Expected ${reference}`);
      const left = Number.parseFloat(cell.style.left);
      const top = Number.parseFloat(cell.style.top);
      const right = left + Number.parseFloat(cell.style.width) + 1;
      const bottom = top + Number.parseFloat(cell.style.height) + 1;
      expect(left).toBeGreaterThanOrEqual(overlayLeft);
      expect(top).toBeGreaterThanOrEqual(overlayTop);
      expect(right).toBeLessThanOrEqual(overlayRight);
      expect(bottom).toBeLessThanOrEqual(overlayBottom);
    }

    // Formula picking does not replace the cell whose formula is being edited.
    expect(manager.selections.at(-1)?.start).toEqual({ row: 0, col: 3 });

    await act(async () => manager?.mouseUp());
    expect(
      document.querySelector<HTMLElement>('[data-testid="spreadsheet-reference-selection"]')
        ?.dataset.referencePhase
    ).toBe('selected');
  });
});
