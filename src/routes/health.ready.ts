import { createFileRoute } from "@tanstack/react-router";
import { readiness } from "~/server/readiness";

export const Route = createFileRoute("/health/ready")({
  server: { handlers: { GET: async () => { const result = await readiness(); return Response.json(result, { status: result.ready ? 200 : 503 }); } } },
});
