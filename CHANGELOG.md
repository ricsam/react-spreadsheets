# Changelog

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
