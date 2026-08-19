/**
 * Cell edit error reporting.
 *
 * The original component reported rejected edits through an app-specific
 * snackbar. A reusable library must not own UI for that, so errors are routed
 * through a subscribable sink instead: by default they are logged, and a host
 * app can subscribe to render them however it likes.
 */

export type CellEditErrorListener = (error: unknown) => void;

const listeners = new Set<CellEditErrorListener>();

/**
 * Subscribes to cell edit errors (e.g. the engine rejecting a formula).
 *
 * @returns An unsubscribe function.
 */
export function onCellEditError(listener: CellEditErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Default `onCellDataChangeError` handler.
 *
 * Notifies subscribers; if there are none it falls back to `console.error` so
 * failures are never silently swallowed during development.
 */
export function queueCellEditError(error: unknown): void {
  if (listeners.size === 0) {
    console.error("Cell edit rejected:", error);
    return;
  }

  listeners.forEach((listener) => {
    try {
      listener(error);
    } catch (listenerError) {
      console.error("Cell edit error listener threw:", listenerError);
    }
  });
}
