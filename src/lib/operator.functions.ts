import { createServerFn } from "@tanstack/react-start";
import type { OperatorSnapshot } from "./operator-types";

export const getOperatorSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperatorSnapshot> => {
    const { readOperator } = await import("./operator-live.server.ts");
    return readOperator();
  },
);

export const tickOperator = createServerFn({ method: "POST" }).handler(
  async (): Promise<OperatorSnapshot> => {
    const { tickOperatorLive } = await import("./operator-live.server.ts");
    return tickOperatorLive();
  },
);
