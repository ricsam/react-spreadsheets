import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register a DOM before any component module is imported so React can render.
if (!globalThis.document) {
  GlobalRegistrator.register();
}
