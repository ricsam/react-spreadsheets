import type { CellStyle } from "@ricsam/formula-engine";

export type BorderSides = NonNullable<CellStyle["borderSides"]>;

export type NormalizedBorderSides = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

/**
 * Normalizes a partial border-sides record into a fully specified one.
 *
 * When `borderSides` is omitted entirely the style is interpreted as "all
 * sides", which matches how a plain `borderColor` is expected to behave.
 *
 * @param sides Partial per-side flags from a `CellStyle`.
 * @param defaultAllWhenUnset Value used for every side when `sides` is undefined.
 */
export function normalizeBorderSides(
  sides: BorderSides | undefined,
  defaultAllWhenUnset = false,
): NormalizedBorderSides {
  if (!sides) {
    return {
      top: defaultAllWhenUnset,
      right: defaultAllWhenUnset,
      bottom: defaultAllWhenUnset,
      left: defaultAllWhenUnset,
    };
  }

  return {
    top: Boolean(sides.top),
    right: Boolean(sides.right),
    bottom: Boolean(sides.bottom),
    left: Boolean(sides.left),
  };
}

/** True when at least one side should be drawn. */
export function hasAnyBorderSide(sides: NormalizedBorderSides): boolean {
  return sides.top || sides.right || sides.bottom || sides.left;
}
