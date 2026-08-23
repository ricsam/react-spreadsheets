import { describe, expect, test } from "bun:test";

const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();

/**
 * Guards the light/dark token strategy.
 *
 * `light-dark()` is deliberately NOT used for the themed tokens. Bundlers that
 * target browsers without native support (Vite's Lightning CSS, for example)
 * lower it to switch custom properties that are only emitted in rules which
 * also declare `color-scheme`. Tokens declared once on a shared root then
 * compute to an invalid value like `#ffffff #0f1523`, every themed surface
 * falls back to `transparent`, and the failure only shows up in a production
 * build. The `--rsp-light` / `--rsp-dark` space toggle avoids that entirely.
 */
describe("styles.css light/dark strategy", () => {
  // Comments contain illustrative CSS, so strip them before any structural
  // assertion or the examples get parsed as real rules.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = source.split("\n");

  /** Rough rule splitter: `[selector, body]` pairs for non-nested blocks. */
  const rules = (): Array<{ selector: string; body: string }> =>
    [...source.matchAll(/(^|\})\s*([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
      selector: match[2]!.trim(),
      body: match[3]!,
    }));

  test("does not use light-dark() in any declaration", () => {
    const offenders = declarations.filter((line) => line.includes("light-dark("));
    expect(offenders).toEqual([]);
  });

  test("defines both scheme switches for the OS default", () => {
    expect(css).toContain("--rsp-light: initial;");
    expect(css).toContain("prefers-color-scheme: dark");
  });

  test("exposes a resolved-scheme hook for both modes", () => {
    expect(css).toContain('[data-rsp-scheme="light"]');
    expect(css).toContain('[data-rsp-scheme="dark"]');
  });

  test("ships opt-in theme helper classes", () => {
    expect(css).toContain(".rsp-theme-light");
    expect(css).toContain(".rsp-theme-dark");
  });

  test("never declares color-scheme on .rsp-root, which would override a consumer pin", () => {
    const rspRootRules = rules().filter((rule) => /\.rsp-root/.test(rule.selector));
    expect(rspRootRules.length).toBeGreaterThan(0);

    const withScheme = rspRootRules
      // The opt-in helpers are allowed (and required) to pin the scheme.
      .filter((rule) => !/rsp-theme-(light|dark)/.test(rule.selector))
      .filter((rule) => /(^|[\s;])color-scheme\s*:/.test(rule.body))
      .map((rule) => rule.selector);

    expect(withScheme).toEqual([]);
  });

  test("declares the themed tokens only on :root, so ancestor overrides win", () => {
    // Repeating the token block on `.rsp-root` would make the built-in default
    // beat a consumer override set on an ancestor, because `.rsp-root` is the
    // closer element. Only the light/dark switches may be repeated there.
    const offenders = rules()
      .filter((rule) => /\.rsp-root/.test(rule.selector))
      .filter((rule) => /--rsp-(?!light\s*:|dark\s*:)[a-z-]+\s*:/.test(rule.body))
      .map((rule) => rule.selector);

    expect(offenders).toEqual([]);
  });

  test("every themed token resolves through the space toggle", () => {
    const tokenLines = declarations.filter((line) =>
      /^\s*--rsp-(bg|surface|header-bg|text|border|gridline|accent|selection-bg)\s*:/.test(line),
    );

    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) {
      expect(line).toContain("var(--rsp-light,");
      expect(line).toContain("var(--rsp-dark,");
    }
  });
});
