import { describe, expect, it } from 'bun:test';
import {
  getCellSnapAnchorFromRect,
  getColumnEdgePosition,
  getNearestColumnEdgeIndex,
  getNearestRowEdgeIndex,
  getRectFromCellSnapAnchor,
  moveCellSnapAnchorToNearestOrigin,
  resizeCellSnapAnchorToNearestEdges
} from './snapping';

describe('spreadsheet textbox snapping', () => {
  it('finds nearest column and row edges with custom dimensions', () => {
    const columnWidths = new Map([
      ['A', 120],
      ['C', 80]
    ]);
    const rowHeights = new Map([
      [1, 40],
      [2, 20],
      [3, 30]
    ]);

    expect(getColumnEdgePosition(0, columnWidths)).toBe(0);
    expect(getColumnEdgePosition(1, columnWidths)).toBe(120);
    expect(getColumnEdgePosition(2, columnWidths)).toBe(220);
    expect(getColumnEdgePosition(3, columnWidths)).toBe(300);
    expect(getNearestColumnEdgeIndex(115, columnWidths)).toBe(1);
    expect(getNearestColumnEdgeIndex(180, columnWidths)).toBe(2);
    expect(getNearestRowEdgeIndex(26, rowHeights)).toBe(1);
    expect(getNearestRowEdgeIndex(76, rowHeights)).toBe(3);
  });

  it('converts an arbitrary text box rectangle to nearest cell-edge anchors', () => {
    const columnWidths = new Map([
      ['A', 120],
      ['C', 80]
    ]);
    const rowHeights = new Map([
      [1, 40],
      [2, 20],
      [3, 30]
    ]);

    expect(
      getCellSnapAnchorFromRect(
        {
          x: 110,
          y: 26,
          width: 180,
          height: 50
        },
        columnWidths,
        rowHeights
      )
    ).toEqual({
      startCol: 1,
      startRow: 1,
      endCol: 3,
      endRow: 3
    });
  });

  it('keeps snapped text boxes at least one cell wide and tall', () => {
    expect(
      getCellSnapAnchorFromRect(
        {
          x: 95,
          y: 28,
          width: 5,
          height: 2
        },
        new Map(),
        new Map()
      )
    ).toEqual({
      startCol: 1,
      startRow: 1,
      endCol: 2,
      endRow: 2
    });
  });

  it('recomputes pixel rectangles from anchors after row and column resizing', () => {
    const columnWidths = new Map([
      ['A', 120],
      ['B', 80]
    ]);
    const rowHeights = new Map([
      [1, 45],
      [2, 35]
    ]);

    expect(
      getRectFromCellSnapAnchor(
        {
          startCol: 0,
          startRow: 0,
          endCol: 2,
          endRow: 2
        },
        columnWidths,
        rowHeights
      )
    ).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 80
    });
  });

  it('moves anchors by snapping the origin while preserving the cell span', () => {
    expect(
      moveCellSnapAnchorToNearestOrigin(
        {
          startCol: 1,
          startRow: 1,
          endCol: 3,
          endRow: 4
        },
        {
          x: 260,
          y: 65,
          width: 200,
          height: 90
        },
        new Map(),
        new Map()
      )
    ).toEqual({
      startCol: 3,
      startRow: 2,
      endCol: 5,
      endRow: 5
    });
  });

  it('resizes only the dragged cell edges and clamps to one cell', () => {
    const anchor = {
      startCol: 1,
      startRow: 1,
      endCol: 3,
      endRow: 3
    };

    expect(
      resizeCellSnapAnchorToNearestEdges(
        anchor,
        {
          x: 290,
          y: 30,
          width: 10,
          height: 60
        },
        'left',
        new Map(),
        new Map()
      )
    ).toEqual({
      startCol: 2,
      startRow: 1,
      endCol: 3,
      endRow: 3
    });

    expect(
      resizeCellSnapAnchorToNearestEdges(
        anchor,
        {
          x: 100,
          y: 30,
          width: 20,
          height: 60
        },
        'right',
        new Map(),
        new Map()
      )
    ).toEqual({
      startCol: 1,
      startRow: 1,
      endCol: 2,
      endRow: 3
    });
  });
});
