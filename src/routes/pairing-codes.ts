import { createFileRoute } from "@tanstack/react-router";
import { pairingJson } from "~/server/hcp/http";
import { createPairingRequest } from "~/server/hcp/pairing";

export const Route = createFileRoute("/pairing-codes")({ server: { handlers: { POST: ({ request }) => pairingJson(request, createPairingRequest) } } });
