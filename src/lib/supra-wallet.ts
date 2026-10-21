import { sha512 } from "@noble/hashes/sha2.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import * as ed from "@noble/ed25519";

ed.hashes.sha512 = sha512;

const RPC = "https://rpc-mainnet.supra.com/rpc/v1";

export type OpenedWallet = {
  seed: Uint8Array;
  publicKey: Uint8Array;
  address: string;
};

export type ChainCheck = {
  onChain: boolean;
  authMatches: boolean | null;
  balance: string | null;
};

export function openWallet(raw: string): OpenedWallet {
  const seed = parseSeed(raw);
  const publicKey = ed.getPublicKey(seed);
  const address = addressFromPublicKey(publicKey);
  return { seed, publicKey, address };
}

export function signText(seed: Uint8Array, text: string): { signature: string; ok: boolean } {
  const message = new TextEncoder().encode(text);
  const signature = ed.sign(message, seed);
  const publicKey = ed.getPublicKey(seed);
  const ok = ed.verify(signature, message, publicKey);
  return { signature: ed.etc.bytesToHex(signature), ok };
}

export function actionText(item: {
  id: number;
  at: number;
  lane: string;
  tone: string;
  symbol: string;
  text: string;
}): string {
  return `operator.v1|${item.id}|${item.at}|${item.lane}|${item.tone}|${item.symbol}|${item.text}`;
}

export async function checkOnChain(address: string): Promise<ChainCheck> {
  const [accountRes, balanceRes] = await Promise.all([
    fetch(`${RPC}/accounts/${address}`),
    fetch(`${RPC}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        function: "0x1::coin::balance",
        type_arguments: ["0x1::supra_coin::SupraCoin"],
        arguments: [address],
      }),
    }),
  ]);

  let onChain = false;
  let authMatches: boolean | null = null;
  if (accountRes.ok) {
    const info = (await accountRes.json()) as { authentication_key?: string } | null;
    if (info && typeof info === "object" && info.authentication_key) {
      onChain = true;
      authMatches = normalizeHex(info.authentication_key) === normalizeHex(address);
    }
  }

  let balance: string | null = null;
  if (balanceRes.ok) {
    const body = (await balanceRes.json()) as { result?: unknown[] };
    const raw = body.result?.[0];
    if (typeof raw === "string" || typeof raw === "number") balance = formatSupra(String(raw));
  }

  return { onChain, authMatches, balance };
}

export function wipe(bytes: Uint8Array | null): void {
  if (bytes) bytes.fill(0);
}

function parseSeed(raw: string): Uint8Array {
  const trimmed = raw.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error("Paste a hex private key.");
  }
  if (trimmed.length === 64) return ed.etc.hexToBytes(trimmed.toLowerCase());
  if (trimmed.length === 128) {
    const seed = ed.etc.hexToBytes(trimmed.slice(0, 64).toLowerCase());
    const claimed = ed.etc.hexToBytes(trimmed.slice(64).toLowerCase());
    const actual = ed.getPublicKey(seed);
    if (!equalBytes(claimed, actual)) {
      throw new Error("The public half of that key does not match. Paste the 32-byte private key.");
    }
    return seed;
  }
  throw new Error("Use a 32-byte Supra private key, 64 hex characters.");
}

function addressFromPublicKey(publicKey: Uint8Array): string {
  const material = new Uint8Array(publicKey.length + 1);
  material.set(publicKey);
  material[publicKey.length] = 0;
  return "0x" + ed.etc.bytesToHex(sha3_256(material));
}

export function formatSupra(raw: string): string {
  const value = BigInt(raw);
  const whole = value / 100_000_000n;
  const frac = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  const digits = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${digits}.${frac}` : digits;
}

function normalizeHex(value: string): string {
  const body = value.trim().toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x${body}`;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
