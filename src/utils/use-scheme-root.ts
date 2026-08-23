import { useState } from "react";
import { useColorScheme, type ColorScheme } from "./use-color-scheme";

/**
 * Props for a `.rsp-root` element so its light/dark tokens match the inherited
 * `color-scheme`.
 *
 * A stylesheet cannot branch on an *ancestor's* `color-scheme`, and the
 * `light-dark()` function is rewritten by some bundlers into switch variables
 * that only exist next to a `color-scheme` declaration (see `styles.css`).
 * Resolving the scheme from the mounted element and reflecting it as
 * `data-rsp-scheme` keeps the tokens correct without the component declaring
 * `color-scheme` itself, which would override a consumer's pin.
 */
export function useSchemeRoot(): {
  ref: (element: HTMLElement | null) => void;
  "data-rsp-scheme": ColorScheme;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const scheme = useColorScheme(element);

  return { ref: setElement, "data-rsp-scheme": scheme };
}
