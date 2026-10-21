import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/operator/tick")({
  server: {
    handlers: {
      GET: async () => {
        const { tickOperatorLive } = await import("@/lib/operator-live.server");
        return Response.json(await tickOperatorLive());
      },
      POST: async () => {
        const { tickOperatorLive } = await import("@/lib/operator-live.server");
        return Response.json(await tickOperatorLive());
      },
    },
  },
});
