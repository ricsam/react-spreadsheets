# Changelog

## 0.0.13

- Seed workbook selection/focus observer baselines so unrelated mouseup/blur events cannot activate saved selections in other panes or overwrite an address-bar draft.
- Cover registration, re-registration, actual focus changes and far-away programmatic navigation with regression tests.

## 0.0.12

- Add named virtual grid, row, cell and header semantics, selected states and indexed coordinates.
- Expose stable per-view cell IDs and A1 `data-cell-address` selectors; label inline editors.
- Activate keyboard navigation on Tab focus without stealing focus from editors/overlays.
- Forward mounted active-cell semantics to selection-manager's optional input-capture accessibility API; existing peer versions remain supported.
- Document virtualized automation and accessibility behavior; add rendering/regression coverage.
