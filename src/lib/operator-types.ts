export type LivePosition = {
  pool: string;
  symbol: string;
  name: string;
  status: string;
  upPct: number | null;
  note: string;
};

export type LiveLog = {
  id: number;
  tone: string;
  symbol: string;
  text: string;
  txHash: string | null;
};

export type OperatorSnapshot = {
  configured: boolean;
  address: string | null;
  balance: string | null;
  onChain: boolean;
  watchingFrom: number | null;
  positions: LivePosition[];
  log: LiveLog[];
  note: string;
};
