/**
 * Contrast helpers for consumer-supplied cell backgrounds.
 *
 * The grid's default text color is theme-aware (`--rsp-text` resolves through
 * `light-dark()`), but a consumer-supplied `backgroundColor` usually is not —
 * spreadsheet fills typically come from a document model that stores one
 * literal color, e.g. `#f1f5f9`.
 *
 * Without help, a light literal fill combined with the dark theme's near-white
 * text renders as white-on-white and the cell becomes unreadable. These helpers
 * pick a readable ink for a known background instead.
 *
 * Only values we can actually parse are considered. Anything dynamic
 * (`var(...)`, `color-mix(...)`, gradients, `transparent`, unknown keywords)
 * returns `undefined` so the caller keeps the inherited themed color.
 */

/** Text colors used when a background is opaque enough to classify. */
const DARK_INK = "#101828";
const LIGHT_INK = "#ffffff";

const NAMED_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
};

type Rgba = { r: number; g: number; b: number; a: number };

const clamp255 = (value: number): number => Math.min(255, Math.max(0, value));

/**
 * Parses hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba() and a small set of
 * common keywords. Returns `undefined` for anything else.
 */
export function parseCssColor(input: string): Rgba | undefined {
  const value = input.trim().toLowerCase();

  if (!value || value === "transparent" || value === "currentcolor" || value === "inherit") {
    return undefined;
  }

  // Dynamic or computed values cannot be resolved without layout.
  if (value.includes("var(") || value.includes("color-mix(") || value.includes("gradient")) {
    return undefined;
  }

  const named = NAMED_COLORS[value];
  if (named) {
    return { r: named[0], g: named[1], b: named[2], a: 1 };
  }

  if (value.startsWith("#")) {
    const hex = value.slice(1);

    const expand = (part: string): number => parseInt(part + part, 16);

    if (hex.length === 3 || hex.length === 4) {
      const r = expand(hex[0]!);
      const g = expand(hex[1]!);
      const b = expand(hex[2]!);
      const a = hex.length === 4 ? expand(hex[3]!) / 255 : 1;
      return Number.isNaN(r + g + b) ? undefined : { r, g, b, a };
    }

    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return Number.isNaN(r + g + b) ? undefined : { r, g, b, a };
    }

    return undefined;
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return undefined;

    const toChannel = (part: string): number =>
      part.endsWith("%") ? (parseFloat(part) / 100) * 255 : parseFloat(part);

    const r = toChannel(parts[0]!);
    const g = toChannel(parts[1]!);
    const b = toChannel(parts[2]!);
    const alphaPart = parts[3];
    const a =
      alphaPart === undefined
        ? 1
        : alphaPart.endsWith("%")
          ? parseFloat(alphaPart) / 100
          : parseFloat(alphaPart);

    if ([r, g, b, a].some((channel) => Number.isNaN(channel))) return undefined;

    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a };
  }

  return undefined;
}

/** Relative luminance per WCAG 2.1. */
export function relativeLuminance({ r, g, b }: Pick<Rgba, "r" | "g" | "b">): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Returns a readable ink for `background`, or `undefined` when the background
 * is unparseable or too translucent to classify (in which case the themed
 * default should keep applying).
 */
export function getContrastingTextColor(background: string): string | undefined {
  const color = parseCssColor(background);

  // A mostly transparent fill lets the themed surface show through, so the
  // inherited themed text color remains the correct choice.
  if (!color || color.a < 0.5) return undefined;

  return relativeLuminance(color) > 0.45 ? DARK_INK : LIGHT_INK;
}
