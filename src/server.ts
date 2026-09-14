// Custom TanStack Start server entry. The production Node process (server/index.mjs)
// imports this bundle: `fetch` serves HTTP, the named exports run the app runtime.
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

export default createServerEntry({ fetch: handler.fetch });
export { createRuntime } from "./server/runtime";
