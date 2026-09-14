import { createFileRoute } from "@tanstack/react-router";
import { pairingJson } from "~/server/hcp/http";
import { issueConnectionToken } from "~/server/hcp/pairing";

export const Route = createFileRoute("/runner-connection-token")({ server: { handlers: { POST: ({ request }) => pairingJson(request, issueConnectionToken) } } });
