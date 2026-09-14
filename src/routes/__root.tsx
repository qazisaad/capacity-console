/// <reference types="vite/client" />
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "~/styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Capacity Console" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: () => { const { queryClient } = Route.useRouteContext(); return <QueryClientProvider client={queryClient}><Outlet /></QueryClientProvider>; },
  notFoundComponent: () => <main className="mx-auto max-w-lg p-10 text-center"><h1 className="text-xl font-semibold">Page not found</h1><p className="mt-2 text-stone-600">Check the address or return to the <a className="underline" href="/">overview</a>.</p></main>,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}<Scripts /></body>
    </html>
  );
}
