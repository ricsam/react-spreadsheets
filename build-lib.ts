import { $ } from "bun";
import path from "path";

/**
 * Builds the distributable package:
 *   dist/mjs/lib.mjs   ESM
 *   dist/cjs/lib.cjs   CommonJS
 *   dist/types/*.d.ts  declarations
 *   dist/styles.css    stylesheet
 *
 * The entry is bundled into a single file per format while every third-party
 * package (react, selection-manager, formula-engine) stays external. Bundling
 * avoids fragile rewriting of relative specifiers and guarantees the emitted
 * entry actually re-exports its symbols.
 */

const root = import.meta.dir;

const bundle = async (type: "cjs" | "mjs") => {
  const result = await Bun.build({
    entrypoints: [path.join(root, "src", "lib.ts")],
    outdir: path.join(root, "dist", type),
    sourcemap: "external",
    format: type === "mjs" ? "esm" : "cjs",
    // Keep every bare-specifier dependency external so consumers dedupe React.
    packages: "external",
    naming: `[name].${type}`,
    target: "browser",
    // Library artifacts must use React's stable jsx/jsxs runtime. Bun defaults
    // to jsxDEV outside production mode, which crashes when a consumer bundles
    // the library for production because react/jsx-runtime has no jsxDEV.
    jsx: {
      runtime: "automatic",
      development: false,
    },
  });

  result.logs.forEach((log) => console.log(`[${log.level}] ${log.message}`));
  if (!result.success) {
    throw new Error(`Failed to build ${type} bundle`);
  }
  console.log(`Built dist/${type}/lib.${type}`);
};

const buildTypes = async () => {
  await Bun.write(
    path.join(root, "tsconfig.types.json"),
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          declarationDir: "dist/types",
          rootDir: "src",
        },
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"],
      },
      null,
      2,
    ),
  );

  const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p tsconfig.types.json`
    .cwd(root)
    .nothrow();

  if (exitCode !== 0) {
    console.error(stderr.toString());
    console.log(stdout.toString());
    throw new Error("Failed to emit type declarations");
  }
  console.log("Built dist/types");
};

await $`rm -rf dist`.cwd(root);

await Promise.all([bundle("mjs"), bundle("cjs"), buildTypes()]);

// Ship the stylesheet at the documented import path.
await Bun.write(
  path.join(root, "dist", "styles.css"),
  await Bun.file(path.join(root, "src", "styles.css")).text(),
);

// Per-directory type markers so Node resolves each format correctly.
const packageJson = await Bun.file(path.join(root, "package.json")).json();
for (const [folder, type] of [
  ["dist/cjs", "commonjs"],
  ["dist/mjs", "module"],
] as const) {
  await Bun.write(
    path.join(root, folder, "package.json"),
    JSON.stringify({ name: packageJson.name, version: packageJson.version, type }, null, 2),
  );
}

console.log(`\nBuilt ${packageJson.name}@${packageJson.version}`);
