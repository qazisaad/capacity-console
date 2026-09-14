import { createFileRoute } from "@tanstack/react-router";
import { pairingJson } from "~/server/hcp/http";
import { exchangePairing } from "~/server/hcp/pairing";

export const Route = createFileRoute("/pairing-exchange")({ server: { handlers: { POST: ({ request }) => pairingJson(request, exchangePairing) } } });
