/**
 * Dev server for the light/dark theme harness.
 *
 * Bun serves `demo/index.html` and bundles the referenced TSX/CSS on demand.
 *   bun run demo
 */
import index from "./index.html";

const port = Number(process.env.PORT ?? 5190);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: true,
  routes: {
    "/": index,
  },
});

console.log(`Theme harness running at ${server.url}`);
