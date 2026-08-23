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

## Theming

All colors, fonts and sizes are CSS custom properties declared on `:root`, so
you can override them from **any** ancestor of the grid:

```css
.my-panel {
  --rsp-accent: #7c3aed;
  --rsp-bg: #ffffff;
  --rsp-header-bg: #f4f4f5;
  --rsp-cell-font-size: 13px;
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
| `columnWidths` / `rowHeights` | Controlled sizing, keyed by column letter / 1-based row. |
| `customCellStyle` | Per-cell `CSSProperties`. |
| `customCellRenderer` | Per-cell React node. |
| `parseValue` | Coerce raw editor strings (e.g. text → number) before storing. |
| `selection` | Selection state, callbacks and `effects(selectionManager)` for copy/paste/fill hooks. |
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
