# @ricsam/react-spreadsheets

React spreadsheet primitives: an infinitely scrollable, virtualized grid with
selection, inline editing, clipboard, fill handles, column/row resizing and
floating overlays — plus optional bindings for
[`@ricsam/formula-engine`](https://github.com/ricsam/formula-engine).

- **Infinite grid** — rows and columns are unbounded; only visible cells render.
- **Canvas gridlines + DOM cells** — crisp lines, fully stylable cells.
- **Zero styling dependencies** — one plain CSS file themed with custom properties.
- **Bring your own state** — controlled or uncontrolled cell data.
- **Optional formula engine** — drop in `FormulaSheet` / `FormulaWorkbook` for
  formulas, spill ranges, tables, styles and multi-sheet workbooks.

## Installation

```bash
bun add @ricsam/react-spreadsheets @ricsam/selection-manager
# optional, for the formula-aware components
bun add @ricsam/formula-engine
```

`react`, `react-dom` and `@ricsam/selection-manager` are peer dependencies.

## Usage

Import the stylesheet once, near your app root:

```ts
import "@ricsam/react-spreadsheets/styles.css";
```

### Standalone grid

```tsx
import { useState } from "react";
import { Spreadsheet, type SerializedCellValue } from "@ricsam/react-spreadsheets";
import "@ricsam/react-spreadsheets/styles.css";

export function Demo() {
  const [cells, setCells] = useState<Map<string, SerializedCellValue>>(
    () => new Map([["A1", "Region"], ["B1", "Revenue"], ["A2", "EMEA"], ["B2", 120]]),
  );

  return (
    <Spreadsheet
      style={{ height: 480 }}
      cellData={cells}
      onCellDataChange={setCells}
    />
  );
}
```

### With the formula engine

```tsx
import { FormulaEngine } from "@ricsam/formula-engine";
import { FormulaSheet } from "@ricsam/react-spreadsheets";
import "@ricsam/react-spreadsheets/styles.css";

const engine = FormulaEngine.buildEmpty();
engine.addWorkbook("Workbook1");
engine.addSheet({ workbookName: "Workbook1", sheetName: "Sheet1" });
engine.setSheetContent(
  { workbookName: "Workbook1", sheetName: "Sheet1" },
  new Map([
    ["A1", 10],
    ["A2", 20],
    ["A3", "=SUM(A1:A2)"], // renders 30
  ]),
);

export function Demo() {
  return (
    <FormulaSheet
      engine={engine}
      workbookName="Workbook1"
      sheetName="Sheet1"
      style={{ height: 480 }}
    />
  );
}
```

`FormulaWorkbook` adds Excel-style sheet tabs, renaming, deletion and zoom on
top of `FormulaSheet`.

### Formula reference highlights

Keep editor-driven reference highlights separate from the user's spreadsheet
selection. `FormulaSheet` calls `customCellStyle` with both the cell and its
engine-provided style, so a host can add a transient range fill and perimeter
without replacing table or conditional formatting:

```tsx
type Highlight = {
  start: { rowIndex: number; colIndex: number };
  end: { rowIndex: number; colIndex: number };
};

function ReferenceAwareSheet({ highlight }: { highlight?: Highlight }) {
  return (
    <FormulaSheet
      engine={engine}
      workbookName="Workbook1"
      sheetName="Sheet1"
      style={{ height: 480 }}
      customCellStyle={(cell, internalStyle) => {
        if (
          !highlight ||
          cell.rowIndex < highlight.start.rowIndex ||
          cell.rowIndex > highlight.end.rowIndex ||
          cell.colIndex < highlight.start.colIndex ||
          cell.colIndex > highlight.end.colIndex
        ) {
          return internalStyle;
        }

        const color = "#7c3aed";
        return {
          ...internalStyle,
          backgroundColor: "rgb(124 58 237 / 14%)",
          ...(cell.rowIndex === highlight.start.rowIndex && { borderTopColor: color }),
          ...(cell.rowIndex === highlight.end.rowIndex && { borderBottomColor: color }),
          ...(cell.colIndex === highlight.start.colIndex && { borderLeftColor: color }),
          ...(cell.colIndex === highlight.end.colIndex && { borderRightColor: color }),
        };
      }}
    />
  );
}
```

Update `highlight` from the formula editor's caret/reference analysis. Clearing
it removes the decoration, while the selection manager continues to own mouse,
keyboard and edit selection state independently. The same `customCellStyle`
prop is forwarded to a `FormulaWorkbook`'s active sheet.

To focus and reveal the reference itself, share a `WorkbookSelectionManager`
with the formula sheets and pass the resolved `RangeAddress` to `focusRange`:

```tsx
const workbookSelection = new WorkbookSelectionManager();

workbookSelection.focusRange(referenceAddress, { align: "nearest" });
```

The call selects the complete target range, focuses its grid and asks the grid
to reveal it. It returns `true` when the target sheet is already mounted. If a
controlled `FormulaWorkbook` still needs to switch `activeSheet`, it returns
`false` and queues the latest request; mounting that sheet applies the focus and
reveal automatically.

If the same workbook can be mounted in more than one place, give each rendered
view a stable ID and target that ID when navigating. Selection caches are also
scoped to the view, so switching sheets or remounting one pane cannot restore a
selection from its duplicate:

```tsx
<FormulaWorkbook
  viewId="left-pane"
  workbookName="Forecast"
  engine={engine}
  selectionManager={workbookSelection}
/>

workbookSelection.focusRange(referenceAddress, {
  align: "nearest",
  viewId: "left-pane",
});
```

Omitting `viewId` preserves the single-view API and targets the first matching
mounted workbook/sheet. Call `cancelPendingFocusRange()` if an app-level sheet
or pane switch is abandoned before the queued target mounts.

For the range currently being inserted into a formula, use selection-manager's
reference-picking mode instead. It preserves the primary/editing selection and
the grid renders the picked range with an independent animated border:

```tsx
<Spreadsheet
  rowCount={1_000}
  columnCount={50}
  selection={{
    effects(manager) {
      const stop = manager.listenToReferenceSelection((event) => {
        if (event.phase === "start" || event.phase === "change") {
          updateFormulaReference(event.range);
        }
      });

      manager.beginReferenceSelection({
        editedRange: {
          start: { row: 1, col: 3 },
          end: {
            row: { type: "number", value: 1 },
            col: { type: "number", value: 3 },
          },
        },
      });
      return () => {
        stop();
        manager.endReferenceSelection();
      };
    },
  }}
/>
```

### Data-aware keyboard navigation

`Cmd/Ctrl + Arrow` jumps through populated cells and reveals the destination;
adding Shift extends the primary selection. Plain `Spreadsheet` derives its
used range and jump targets from non-empty `cellData`. `FormulaSheet` also
supplies table bounds from the formula engine, so navigation inside a table
respects its data body.

Override any part of that behavior through `selection.navigation`:

```tsx
<Spreadsheet
  rowCount={100_000}
  columnCount={200}
  selection={{
    navigation: {
      getUsedRange: () => model.usedRange,
      getTableAt: (cell) => model.tableAt(cell),
      resolveTarget: (request) => model.resolveJump(request),
    },
  }}
/>
```

The imperative `SpreadsheetRef.scrollToCell({ row, col }, { align })` reveals a
cell without changing selection. Alignment is `"nearest"` by default, with
`"start"` and `"end"` available for explicit positioning.

`SpreadsheetRef.scrollToRange(range, { align })` does the same for an `SMArea`.
Finite ranges may be supplied in either direction and are clamped to finite grid
bounds. An open-ended axis reaches the final row or column of a finite grid; on
an unbounded grid its finite start is used as the reveal anchor.

## Theming

All colors, fonts and sizes are CSS custom properties. The package only ever
*reads* the public `--rsp-*` names, so an override on **any** ancestor of the
grid always wins:

```css
.my-panel {
  --rsp-accent: #7c3aed;
  --rsp-bg: #ffffff;
  --rsp-header-bg: #f4f4f5;
  --rsp-cell-font-size: 13px;
}
```

An override replaces both schemes, so pick a value that works in the mode(s) you
support, or scope it per scheme:

```css
.my-panel { --rsp-bg: #ffffff; }
@media (prefers-color-scheme: dark) {
  .my-panel { --rsp-bg: #10131a; }
}
```

### Light and dark

By default the grid follows the user's OS preference.

The grid deliberately does **not** declare `color-scheme` on `.rsp-root`, so a
pin you set on an ancestor is respected. Pin a subtree with plain CSS:

```css
.workbook-stage { color-scheme: light; } /* always light */
.workbook-stage { color-scheme: dark; }  /* always dark  */
```

or with the bundled helper classes:

```tsx
<FormulaWorkbook className="rsp-theme-dark" ... />
```

Canvas gridlines and every DOM surface follow the same resolved scheme. The
component resolves the inherited `color-scheme` and reflects it on the grid root
as `data-rsp-scheme`, which drives the `--rsp-light` / `--rsp-dark` token
switches.

> **Note** — the stylesheet intentionally avoids `light-dark()`. Bundlers that
> target browsers without native support (Vite's Lightning CSS, for example)
> lower it to switch variables that only exist next to a `color-scheme`
> declaration, which makes shared-root tokens compute to an invalid value — in
> production builds only. An equivalent space-toggle is used instead.

> **Note** — internally each public token is aliased to a private `--_rsp-*`
> property declared on `.rsp-root`, and the rules consume the private name. A
> custom property containing `var()` is substituted at the element where it is
> *declared*, so themed values declared on `:root` would be resolved against the
> document root and a subtree pin could never change them. Treat `--_rsp-*` as
> private and always override the public `--rsp-*` name.

### Cell fills stay readable

A `backgroundColor` coming from your document model is usually a single literal
color with no dark-mode variant. To stop light fills from pairing with the dark
theme's near-white text, the grid derives a readable ink for any cell that sets
a background but no explicit `color`. Set `color` yourself to opt out, and use
`getContrastingTextColor` if you want the same behaviour elsewhere.

Per-cell styling is done in JS:

```tsx
<Spreadsheet
  cellData={cells}
  customCellStyle={(cell) =>
    typeof cell.value === "number" && cell.value < 0
      ? { color: "#dc2626", fontWeight: 600 }
      : {}
  }
  customCellRenderer={(cell) => <span>{String(cell.value ?? "")}</span>}
/>
```

## Key props

| Prop | Description |
| --- | --- |
| `cellData` | `Map<string, SerializedCellValue>` keyed by A1 reference. Omit for uncontrolled mode. |
| `onCellDataChange` | Called with the next map after an edit, paste or fill. |
| `rowCount` / `columnCount` | Finite grid dimensions. Omit either dimension for an unbounded axis. |
| `columnWidths` / `rowHeights` | Controlled sizing, keyed by column letter / 1-based row. |
| `customCellStyle` | Per-cell `CSSProperties`. |
| `customCellRenderer` | Per-cell React node. |
| `parseValue` | Coerce raw editor strings (e.g. text → number) before storing. |
| `selection` | Selection state, navigation model, and `effects(selectionManager)` for copy/paste/fill/reference hooks. |
| `components` + `overlayChildren` | Floating overlays anchored to the grid, optionally snapped to cell edges. |

## Development

```bash
bun install
bun test        # unit + React rendering tests
bun run typecheck
bun run build   # emits dist/{mjs,cjs,types} + styles.css
```

## License

MIT
