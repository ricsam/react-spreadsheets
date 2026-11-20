# Changelog

## 0.0.16

- Sort and filter formula-engine tables from the grid: `FormulaSheet` renders a sort and filter button in each table header cell (opt out with `tableFilterButtons={false}`; Alt+Down opens it from the keyboard). The menu sorts ascending or descending, filters by a condition or by a searchable list of the column's values with counts and (Blanks), and clears the column's filter. Each choice is one engine call (`sortTable` / `setTableColumnFilter`), so one undo step.
- Add `Spreadsheet` `hiddenRows`: rows laid out at zero height, without headers or cells, with the next row header marked `rsp-header-after-hidden`. They are passed to the selection manager, so navigation and Cmd/Ctrl+Arrow jumps step over them, and copies leave them out (`ExtractedCells.rows` and `origin` describe the copy). `FormulaSheet` derives them from `engine.getHiddenRows`, plus any `hiddenRows` it is given.
- Over filtered rows, `FormulaSheet` fills and clears only the shown rows (`splitVisibleRows`), and `WorkbookClipboardManager` pastes a copy of filtered rows as consecutive rows (`copiedRows`, `copiedOrigin`).
- Export `TableFilterButton`, `TableFilterMenu`, `getTableHeaderFilterState` and `splitVisibleRows`.
- Peers: `@ricsam/formula-engine` >=0.6.0 (table sort and filter APIs) and `@ricsam/selection-manager` >=0.0.36 (hidden rows).

## 0.0.15

- Commit FormulaSheet inline edits, external pastes and clears as changed-cell patches in one engine transaction, avoiding full-sheet copies/coercion and preserving unrelated warm evaluation caches.
- Add optional Spreadsheet `onCellDataPatch`; retain the legacy whole-map `onCellDataChange` path and rejected-editor draft restoration.
- Cover dependency recalculation, cache retention, typed input, deletion, atomic bulk undo/redo, rollback and table-header validation with engine 0.3.7 (development dependency only; peers unchanged).
- Include the previously committed workbook navigation and sheet-action usability improvements (2c8b593).

## 0.0.14

- Stabilize FormulaSheet render callbacks so selection-only changes repaint affected cells rather than the entire visible grid.
- Share bounded engine style reads between cell containers and content; invalidate on all engine updates, including cross-sheet dependencies, styles, metadata, undo and redo.
- Honor imported workbook metadata `defaultCellStyle`, including font family, with explicit cell styles taking precedence; preserve existing defaults for older imports without metadata.
- Respect explicit false bold, italic and underline values and retain selection-sensitive consumer callbacks.
- Include the existing main-branch workbook selection/focus observer baseline fix (b86be66) and its regression coverage.
- Add renderer/style call-count and cache-invalidation regression coverage.

## 0.0.13

- Seed workbook selection/focus observer baselines so unrelated mouseup/blur events cannot activate saved selections in other panes or overwrite an address-bar draft.
- Cover registration, re-registration, actual focus changes and far-away programmatic navigation with regression tests.

## 0.0.12

- Add named virtual grid, row, cell and header semantics, selected states and indexed coordinates.
- Expose stable per-view cell IDs and A1 `data-cell-address` selectors; label inline editors.
- Activate keyboard navigation on Tab focus without stealing focus from editors/overlays.
- Forward mounted active-cell semantics to selection-manager's optional input-capture accessibility API; existing peer versions remain supported.
- Document virtualized automation and accessibility behavior; add rendering/regression coverage.
