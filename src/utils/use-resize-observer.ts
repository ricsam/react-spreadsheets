import { useCallback, useRef, useState } from "react";

export interface ResizeObserverSize {
  width: number;
  height: number;
}

/**
 * Observes the size of an element via a callback ref.
 *
 * Returns `[size, ref]` so the consumer can spread the ref onto any element.
 * Falls back to `getBoundingClientRect` once on attach so the first paint has
 * usable dimensions even before the observer fires.
 */
export function useResizeObserver<T extends HTMLElement = HTMLDivElement>(): [
  ResizeObserverSize,
  (element: T | null) => void,
] {
  const [size, setSize] = useState<ResizeObserverSize>({
    width: 0,
    height: 0,
  });

  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!element) return;

    const rect = element.getBoundingClientRect();
    setSize((previous) =>
      previous.width === rect.width && previous.height === rect.height
        ? previous
        : { width: rect.width, height: rect.height },
    );

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // `contentRect` is widely supported and sufficient here; border-box
      // sizing is not needed because the grid measures its own padding.
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });

    observer.observe(element);
    observerRef.current = observer;
  }, []);

  return [size, ref];
}
