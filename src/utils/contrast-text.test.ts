import { describe, expect, test } from "bun:test";
import { getContrastingTextColor, parseCssColor, relativeLuminance } from "./contrast-text";

const DARK_INK = "#101828";
const LIGHT_INK = "#ffffff";

describe("parseCssColor", () => {
  test("parses 6-digit hex", () => {
    expect(parseCssColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  test("parses shorthand hex", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  test("parses hex with alpha", () => {
    const parsed = parseCssColor("#00000080");
    expect(parsed?.r).toBe(0);
    expect(parsed?.a).toBeCloseTo(0.502, 2);
  });

  test("parses rgb() and rgba()", () => {
    expect(parseCssColor("rgb(16, 24, 40)")).toEqual({ r: 16, g: 24, b: 40, a: 1 });
    expect(parseCssColor("rgba(255, 255, 255, 0.5)")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 0.5,
    });
  });

  test("parses common keywords, case-insensitively", () => {
    expect(parseCssColor("White")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  test("returns undefined for values that need layout to resolve", () => {
    expect(parseCssColor("var(--x)")).toBeUndefined();
    expect(parseCssColor("color-mix(in srgb, red, blue)")).toBeUndefined();
    expect(parseCssColor("linear-gradient(red, blue)")).toBeUndefined();
    expect(parseCssColor("transparent")).toBeUndefined();
    expect(parseCssColor("currentColor")).toBeUndefined();
    expect(parseCssColor("")).toBeUndefined();
    expect(parseCssColor("not-a-color")).toBeUndefined();
  });
});

describe("relativeLuminance", () => {
  test("is 0 for black and 1 for white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe("getContrastingTextColor", () => {
  test("returns dark ink on light fills", () => {
    // This is the exact fill from the reported bug (the model's "Total" row),
    // which previously inherited near-white text in dark mode.
    expect(getContrastingTextColor("#f1f5f9")).toBe(DARK_INK);
    expect(getContrastingTextColor("#ffffff")).toBe(DARK_INK);
    expect(getContrastingTextColor("#eef2ff")).toBe(DARK_INK);
    expect(getContrastingTextColor("#ecfdf5")).toBe(DARK_INK);
  });

  test("returns light ink on dark fills", () => {
    expect(getContrastingTextColor("#111827")).toBe(LIGHT_INK);
    expect(getContrastingTextColor("#3b6cf5")).toBe(LIGHT_INK);
    expect(getContrastingTextColor("#000000")).toBe(LIGHT_INK);
  });

  test("defers to the themed color when the fill is unparseable", () => {
    expect(getContrastingTextColor("var(--rsp-table-header-bg)")).toBeUndefined();
    expect(getContrastingTextColor("transparent")).toBeUndefined();
  });

  test("defers to the themed color when the fill is mostly transparent", () => {
    // The themed surface shows through, so the inherited ink is still correct.
    expect(getContrastingTextColor("rgba(255, 255, 255, 0.2)")).toBeUndefined();
  });
});
