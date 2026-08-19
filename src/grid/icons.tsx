/**
 * Inline icons.
 *
 * The library intentionally ships no icon dependency, so the handful of glyphs
 * used by overlay frames are defined here as plain SVG. Paths are from the
 * Material Design icon set (Apache-2.0).
 */
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "size"> & { size?: number };

const iconBase = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  focusable: false,
});

export function DeleteIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...iconBase(size)} {...props}>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

export function GridOnIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...iconBase(size)} {...props}>
      <path d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z" />
    </svg>
  );
}

export function GridOffIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...iconBase(size)} {...props}>
      <path d="M8 4v1.45l2 2V4h4v4h-3.45l2 2H14v1.45l2 2V10h4v4h-3.45l2 2H20v1.45l1.71 1.71c.18-.28.29-.6.29-.96V4c0-1.1-.9-2-2-2H4.55L6.55 4H8zm12 0v4h-4V4h4zM1.27 1.27L0 2.55l2 2V20c0 1.1.9 2 2 2h15.46l2 2 1.27-1.27L1.27 1.27zM10 12.55L11.45 14H10v-1.45zm-6-6L5.45 8H4V6.55zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm6 6h-4v-4h4v4zm2 0v-1.45L17.45 20H16z" />
    </svg>
  );
}
