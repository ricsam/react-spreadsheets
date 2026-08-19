import { useEffect, useState } from "react";

export type ColorScheme = "light" | "dark";

/**
 * Resolves the effective color scheme for canvas painting.
 *
 * CSS handles theming through `light-dark()`, but the 2D canvas context cannot
 * use it, so grid lines need a concrete resolved value. When an element is
 * supplied we read its computed `color-scheme`, which lets a consumer pin a
 * subtree to one mode; otherwise we fall back to the OS preference.
 */
export function useColorScheme(element?: HTMLElement | null): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>("light");

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const resolve = (): ColorScheme => {
      if (element && typeof getComputedStyle === "function") {
        const declared = getComputedStyle(element).colorScheme;
        // Only an explicit single-value declaration overrides the OS setting;
        // "light dark" and "normal" mean "follow the user preference".
        if (declared === "dark") return "dark";
        if (declared === "light") return "light";
      }
      return query.matches ? "dark" : "light";
    };

    setScheme(resolve());

    const onChange = () => setScheme(resolve());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [element]);

  return scheme;
}
