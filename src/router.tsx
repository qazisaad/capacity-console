import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createQueryClient } from "./lib/query";

export function getRouter() {
  const queryClient = createQueryClient();
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true, defaultPreloadStaleTime: 0 });
}
