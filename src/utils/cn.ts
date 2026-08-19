/**
 * Minimal class name joiner.
 *
 * Deliberately dependency-free: this library ships no styling framework and
 * only needs truthy filtering + joining for CSS module class composition.
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;

    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value === "object") {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) out.push(key);
      }
    }
  };

  values.forEach(walk);

  return out.join(" ");
}
