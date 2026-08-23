import { describe, expect, test } from "bun:test";

const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();

/**
 * Guards the light/dark token strategy.
 *
 * Two independent failure modes are covered here, both of which shipped as real
 * bugs at some point:
 *
 * 1. `light-dark()` must not be used. Bundlers that target browsers without
 *    native support (Vite's Lightning CSS, for example) lower it to switch
 *    custom properties that are only emitted in rules which also declare
 *    `color-scheme`. Tokens declared once on a shared root then compute to an
 *    invalid value like `#ffffff #0f1523`, every themed surface falls back to
 *    `transparent`, and the failure only shows up in a production build.
 *
 * 2. The themed values must be declared on `.rsp-root`, not on `:root`. A
 *    custom property containing `var()` is substituted at the element where it
 *    is *declared*; only the result inherits. Themed values declared on `:root`
 *    are therefore resolved with `:root`'s switches, which makes the resolved
 *    `data-rsp-scheme` pin inert and repaints a light-pinned grid dark on a
 *    dark-mode device.
 *
 * The package reads the public `--rsp-*` names but never declares them, so a
 * consumer override on any ancestor always wins.
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

  /** Every `--x: ...` property name declared anywhere in the stylesheet. */
  const declaredProperties = (): string[] =>
    [...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!);

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

  test("never declares a public --rsp-* token, so ancestor overrides always win", () => {
    // The only public names the package may declare are the two switches; every
    // themed value is declared under the private `--_rsp-` prefix. Declaring a
    // public token would let the built-in default beat a consumer override.
    const offenders = declaredProperties().filter(
      (name) => name.startsWith("--rsp-") && name !== "--rsp-light" && name !== "--rsp-dark",
    );

    expect(offenders).toEqual([]);
  });

  test("declares the private token layer on .rsp-root, so the resolved pin applies", () => {
    // If these lived on `:root` the switch would be evaluated against the
    // document root and `data-rsp-scheme` could never change the branch.
    const privateTokenRules = rules().filter((rule) => /--_rsp-[\w-]+\s*:/.test(rule.body));

    expect(privateTokenRules.length).toBeGreaterThan(0);
    for (const rule of privateTokenRules) {
      expect(rule.selector).toContain(".rsp-root");
    }
  });

  test("every private token falls back to its public --rsp-* name", () => {
    const aliasLines = declarations.filter((line) => /^\s*--_rsp-[\w-]+\s*:/.test(line));

    expect(aliasLines.length).toBeGreaterThan(20);
    for (const line of aliasLines) {
      const name = /^\s*--_rsp-([\w-]+)\s*:/.exec(line)![1];
      // e.g. `--_rsp-bg: var(--rsp-bg, ...)`
      expect(line).toContain(`var(--rsp-${name},`);
    }
  });

  test("themed private tokens resolve through the space toggle", () => {
    const themed = declarations.filter((line) =>
      /^\s*--_rsp-(bg|surface|header-bg|text|border|gridline|accent|selection-bg)\s*:/.test(line),
    );

    expect(themed.length).toBeGreaterThan(0);
    for (const line of themed) {
      expect(line).toContain("var(--rsp-light,");
      expect(line).toContain("var(--rsp-dark,");
    }
  });

  test("rules consume the private tokens, never the public ones", () => {
    // A rule reading `var(--rsp-accent)` directly would bypass the private
    // layer and lose the built-in default when no override is set.
    const offenders = declarations
      .map((line, index) => ({ line, index }))
      // Alias declarations legitimately read the public name as a fallback.
      .filter(({ line }) => !/^\s*--_rsp-[\w-]+\s*:/.test(line))
      .filter(({ line }) => /var\(\s*--rsp-(?!light|dark)/.test(line))
      .map(({ line, index }) => `${index + 1}: ${line.trim()}`);

    expect(offenders).toEqual([]);
  });
});
