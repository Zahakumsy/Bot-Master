import { defineTask } from "nitro/task";

export default defineTask({
  meta: {
    name: "operator:tick",
    description: "Buy and sell real Atmos Token Studio coins with the server key",
  },
  async run() {
    const { tickOperatorLive } = await import("../../../src/lib/operator-live.server.ts");
    const snap = await tickOperatorLive();
    return { result: { configured: snap.configured, note: snap.note } };
  },
});
