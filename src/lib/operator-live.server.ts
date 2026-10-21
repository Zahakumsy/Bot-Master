import { BCS, HexString, SupraAccount, SupraClient, TxnBuilderTypes } from "supra-l1-sdk";
import { getSql, type Sql } from "./db";
import type { LiveLog, LivePosition, OperatorSnapshot } from "./operator-types";
import { formatSupra, openWallet, type OpenedWallet } from "./supra-wallet";

const RPC = "https://rpc-mainnet.supra.com";
const PUMP = "0xa4a4a31116e114bf3c4f4728914e6b43db73279a4421b0768993e07248fe2234";
const OCTAS = 100_000_000n;
const STUDIO_IN = 50_000n * OCTAS;
const PRICE_SCALE = 1_000_000_000n;
const HOUR_MS = 60 * 60 * 1000;
const MAX_OPEN = 6;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

type Row = Record<string, unknown>;

let clientPromise: Promise<SupraClient> | null = null;

function client(): Promise<SupraClient> {
  clientPromise ??= SupraClient.init(RPC);
  return clientPromise;
}

function scrub(message: string): string {
  return message.replace(/0x[0-9a-fA-F]{16,}/g, "0x…").replace(/[0-9a-fA-F]{64}/g, "…").slice(0, 280);
}

function keypair(): OpenedWallet | null {
  const raw = process.env.SUPRA_PRIVATE_KEY?.trim();
  if (!raw) return null;
  return openWallet(raw);
}

function bi(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const text = String(value ?? "0").trim();
  if (!text || text === "null") return 0n;
  return BigInt(text);
}

function hex(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  return text.startsWith("0x") ? text : `0x${text}`;
}

async function view(fn: string, typeArguments: string[], args: string[]): Promise<unknown[]> {
  const res = await fetch(`${RPC}/rpc/v1/view`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ function: fn, type_arguments: typeArguments, arguments: args }),
  });
  const body = (await res.json()) as { result?: unknown[]; message?: string };
  if (!res.ok || !body.result) {
    throw new Error(body.message || `view ${fn} failed`);
  }
  return body.result;
}

async function headHeight(): Promise<number> {
  const res = await fetch(`${RPC}/rpc/v1/block`);
  const body = (await res.json()) as { height?: number };
  if (!body.height) throw new Error("Supra head is unreadable");
  return body.height;
}

async function supraBalance(address: string): Promise<bigint> {
  try {
    const result = await view("0x1::coin::balance", ["0x1::supra_coin::SupraCoin"], [address]);
    return bi(result[0]);
  } catch {
    return 0n;
  }
}

type ChainEvent = {
  height: number;
  hash: string;
  kind: "created" | "traded" | "completed";
  data: Record<string, unknown>;
};

async function pullEvents(kind: ChainEvent["kind"], start: number, end: number): Promise<ChainEvent[]> {
  const name = kind === "created" ? "Created" : kind === "traded" ? "Traded" : "PoolCompleted";
  const url = `${RPC}/rpc/v3/events/${encodeURIComponent(`${PUMP}::atmos_pump::${name}`)}?start_height=${start}&end_height=${end}&limit=40`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: { block_height?: number; transaction_hash?: string; event?: { data?: Record<string, unknown> } }[];
  };
  return (body.data ?? []).map((row) => ({
    height: Number(row.block_height ?? start),
    hash: String(row.transaction_hash ?? ""),
    kind,
    data: row.event?.data ?? {},
  }));
}

async function log(sql: Sql, tone: string, symbol: string, text: string, txHash?: string) {
  await sql`insert into operator_log (at_ms, tone, symbol, text, tx_hash) values (${Date.now()}, ${tone}, ${symbol}, ${text}, ${txHash ?? null})`;
  await sql`delete from operator_log where id in (select id from operator_log order by id desc offset 160)`;
}

type Position = {
  pool: string;
  token: string;
  symbol: string;
  name: string;
  creator: string;
  status: string;
  tokens: bigint;
  supraSpent: bigint;
  price: bigint;
  peak: bigint;
  openedMs: number;
  hitDouble: boolean;
  runnerTrimmed: boolean;
  devSold: boolean;
  graduated: boolean;
};

function mapPosition(row: Row): Position {
  return {
    pool: String(row.pool),
    token: String(row.token),
    symbol: String(row.symbol),
    name: String(row.name),
    creator: String(row.creator),
    status: String(row.status),
    tokens: bi(row.tokens),
    supraSpent: bi(row.supra_spent),
    price: bi(row.price),
    peak: bi(row.peak_price),
    openedMs: Number(row.opened_ms ?? 0),
    hitDouble: Boolean(row.hit_double),
    runnerTrimmed: Boolean(row.runner_trimmed),
    devSold: Boolean(row.dev_sold),
    graduated: Boolean(row.graduated),
  };
}

async function positions(sql: Sql): Promise<Position[]> {
  const rows = await sql<Row>`select * from operator_positions order by opened_ms desc`;
  return rows.map(mapPosition);
}

function upPct(tokens: bigint, price: bigint, cost: bigint): number | null {
  if (tokens <= 0n || price <= 0n || cost <= 0n) return null;
  const value = (tokens * price) / PRICE_SCALE;
  return Number((value * 10000n) / cost) / 100 - 100;
}

function doubled(tokens: bigint, price: bigint, cost: bigint): boolean {
  if (tokens <= 0n || cost <= 0n) return false;
  return tokens * price >= cost * 2n * PRICE_SCALE;
}

function atTwoFifty(tokens: bigint, price: bigint, cost: bigint): boolean {
  if (tokens <= 0n || cost <= 0n) return false;
  return tokens * price * 2n >= cost * 7n * PRICE_SCALE;
}

async function details(pool: string): Promise<{ price: bigint; completed: boolean; symbol: string; name: string } | null> {
  try {
    const result = await view(`${PUMP}::atmos_pump::get_token_details`, [], [pool]);
    const row = result[0] as Record<string, unknown>;
    return {
      price: bi(row.price),
      completed: Boolean(row.is_completed),
      symbol: String(row.symbol ?? ""),
      name: String(row.name ?? ""),
    };
  } catch {
    return null;
  }
}

async function balanceOf(owner: string, token: string): Promise<bigint> {
  try {
    const result = await view(`${PUMP}::atmos_pump::get_user_balance`, [], [owner, token]);
    return bi(result[0]);
  } catch {
    return 0n;
  }
}

async function quoteBuy(pool: string): Promise<bigint | null> {
  try {
    const result = await view(`${PUMP}::atmos_pump::simulate_buy`, [], [pool, STUDIO_IN.toString()]);
    const tokens = bi(result[0]);
    return tokens > 0n ? (tokens * 92n) / 100n : null;
  } catch {
    return null;
  }
}

async function quoteSell(pool: string, amount: bigint): Promise<bigint> {
  try {
    const result = await view(`${PUMP}::atmos_pump::simulate_sell`, [], [pool, amount.toString()]);
    const net = bi(result[2]);
    return net > 0n ? (net * 92n) / 100n : 0n;
  } catch {
    return 0n;
  }
}

const stringTag = () => new TxnBuilderTypes.TypeTagParser("0x1::string::String").parseTypeTag();

async function submitEntry(
  account: SupraAccount,
  fn: "buy" | "sell",
  args: Uint8Array[],
): Promise<string> {
  const supra = await client();
  const info = await supra.getAccountInfo(account.address());
  const serialized = await supra.createSerializedRawTxObject(
    account.address(),
    bi(info.sequence_number),
    PUMP.slice(2),
    "atmos_pump",
    fn,
    [stringTag()],
    args,
    { maxGas: 20_000n, gasUnitPrice: 100_000n },
  );
  const sent = await supra.sendTxUsingSerializedRawTransaction(account, serialized, {
    enableTransactionSimulation: true,
    enableWaitForTransaction: false,
  });
  return sent.txHash;
}

function addressArg(value: string): Uint8Array {
  return new HexString(value).toUint8Array();
}

async function savePosition(sql: Sql, pos: Position) {
  await sql`
    update operator_positions set
      status = ${pos.status},
      tokens = ${pos.tokens.toString()},
      supra_spent = ${pos.supraSpent.toString()},
      price = ${pos.price.toString()},
      peak_price = ${pos.peak.toString()},
      hit_double = ${pos.hitDouble},
      runner_trimmed = ${pos.runnerTrimmed},
      dev_sold = ${pos.devSold},
      graduated = ${pos.graduated}
    where pool = ${pos.pool}
  `;
}

async function tryBuy(
  sql: Sql,
  account: SupraAccount,
  address: string,
  openCount: number,
  event: ChainEvent,
): Promise<number> {
  const pool = hex(event.data.bonding_curve);
  const token = hex(event.data.token_address);
  const symbol = String(event.data.symbol ?? "NEW").slice(0, 16);
  const name = String(event.data.name ?? symbol).slice(0, 80);
  const creator = hex(event.data.created_by);
  if (!pool || !token) return openCount;
  const existing = await sql`select pool from operator_positions where pool = ${pool}`;
  if (existing.length) return openCount;
  if (openCount >= MAX_OPEN) {
    await log(sql, "watch", symbol, "Skipped. Six studio clips are already open.");
    return openCount;
  }
  const info = await details(pool);
  if (!info || info.completed) {
    await log(sql, "watch", symbol, "Skipped. The curve was already finished.");
    return openCount;
  }
  const treasury = await supraBalance(address);
  if (treasury < STUDIO_IN + 2n * OCTAS) {
    await log(sql, "bad", symbol, "Skipped. Treasury is under 50,000 SUPRA plus gas.");
    return openCount;
  }
  const minOut = await quoteBuy(pool);
  if (!minOut) {
    await log(sql, "watch", symbol, "Skipped. The buy quote failed.");
    return openCount;
  }
  await sql`
    insert into operator_positions (
      pool, token, symbol, name, creator, status, tokens, supra_spent, price, peak_price, opened_ms
    ) values (
      ${pool}, ${token}, ${symbol}, ${name}, ${creator}, 'pending', '0', ${STUDIO_IN.toString()},
      '0', '0', ${Date.now()}
    )
  `;
  try {
    const hash = await submitEntry(account, "buy", [
      addressArg(pool),
      BCS.bcsSerializeUint64(STUDIO_IN),
      BCS.bcsSerializeUint64(minOut),
      BCS.bcsSerializeBool(false),
      addressArg(ZERO),
    ]);
    await log(sql, "buy", symbol, "Bought 50,000 SUPRA on the new curve.", hash);
    return openCount + 1;
  } catch (error) {
    await sql`delete from operator_positions where pool = ${pool} and status = 'pending'`;
    await log(sql, "bad", symbol, `Buy was not sent. ${scrub(error instanceof Error ? error.message : "quote failed")}`);
    return openCount;
  }
}

async function sellAmount(
  sql: Sql,
  account: SupraAccount,
  pos: Position,
  amount: bigint,
  why: string,
  next: Partial<Position>,
): Promise<Position> {
  if (amount <= 0n) return pos;
  const minOut = await quoteSell(pos.pool, amount);
  try {
    const hash = await submitEntry(account, "sell", [
      addressArg(pos.pool),
      BCS.bcsSerializeUint64(amount),
      BCS.bcsSerializeUint64(minOut),
      BCS.bcsSerializeBool(false),
      addressArg(ZERO),
    ]);
    const left = pos.tokens > amount ? pos.tokens - amount : 0n;
    const spent = pos.tokens > 0n ? (pos.supraSpent * left) / pos.tokens : 0n;
    const updated: Position = {
      ...pos,
      ...next,
      tokens: left,
      supraSpent: left === 0n ? 0n : spent,
      status: left === 0n ? "closed" : (next.status ?? pos.status),
    };
    if (left > 0n) {
      const after = await details(pos.pool);
      if (after) {
        updated.price = after.price;
        updated.peak = after.price;
      }
    }
    await savePosition(sql, updated);
    await log(sql, "sell", pos.symbol, why, hash);
    return updated;
  } catch (error) {
    await log(sql, "bad", pos.symbol, `Sell was not sent. ${scrub(error instanceof Error ? error.message : "quote failed")}`);
    return pos;
  }
}

async function manage(sql: Sql, account: SupraAccount, address: string, pos: Position): Promise<void> {
  if (pos.status === "closed") return;
  if (pos.status === "pending") {
    const held = await balanceOf(address, pos.token);
    if (held > 0n) {
      const info = await details(pos.pool);
      pos.tokens = held;
      pos.price = info?.price ?? 0n;
      pos.peak = pos.price;
      pos.status = "open";
      await savePosition(sql, pos);
    } else if (Date.now() - pos.openedMs > 3 * 60 * 1000) {
      await sql`delete from operator_positions where pool = ${pos.pool} and status = 'pending'`;
      await log(sql, "bad", pos.symbol, "The buy did not land. Clip cleared.");
    }
    return;
  }

  const held = await balanceOf(address, pos.token);
  if (held > 0n) pos.tokens = held;
  const info = await details(pos.pool);
  if (info) {
    pos.price = info.price;
    if (info.completed) pos.graduated = true;
    if (info.price > pos.peak) pos.peak = info.price;
  }
  if (pos.tokens <= 0n) {
    pos.status = "closed";
    await savePosition(sql, pos);
    return;
  }

  const full =
    pos.devSold ||
    pos.graduated ||
    (!pos.hitDouble && Date.now() - pos.openedMs >= HOUR_MS) ||
    (pos.hitDouble && pos.peak > 0n && pos.price * 100n <= pos.peak * 75n);

  if (full) {
    const why = pos.devSold
      ? "Creator sold. Exited the rest."
      : pos.graduated
        ? "Curve graduated. Sold the runner."
        : !pos.hitDouble
          ? "One hour without a double. Sold the clip."
          : "Gave back 25% from the peak. Sold the runner.";
    await sellAmount(sql, account, pos, pos.tokens, why, { status: "closed" });
    return;
  }

  if (!pos.hitDouble && doubled(pos.tokens, pos.price, pos.supraSpent)) {
    const amount = (pos.tokens * 60n) / 100n;
    const updated = await sellAmount(sql, account, pos, amount, "Up 100% from cost. Sold 60%.", {
      hitDouble: true,
      status: "runner",
    });
    await savePosition(sql, updated);
    return;
  }

  if (pos.hitDouble && !pos.runnerTrimmed && atTwoFifty(pos.tokens, pos.price, pos.supraSpent)) {
    const amount = pos.tokens / 2n;
    await sellAmount(sql, account, pos, amount, "Up 250% from cost. Trimmed half the runner.", {
      runnerTrimmed: true,
      status: "runner",
    });
    return;
  }

  await savePosition(sql, pos);
}

async function readOperator(): Promise<OperatorSnapshot> {
  const sql = await getSql();
  let configured = false;
  let address: string | null = null;
  let note = "Add SUPRA_PRIVATE_KEY on the host. The page never stores the key.";
  try {
    const opened = keypair();
    if (opened) {
      configured = true;
      address = opened.address;
      note = "Key is on the server. New Token Studio launches are bought with 50,000 SUPRA.";
    }
  } catch {
    note = "SUPRA_PRIVATE_KEY is set, but it is not a 32-byte hex private key.";
  }

  const state = await sql<Row>`select cursor_height from operator_state where id = 1`;
  const watching = state[0]?.cursor_height;
  const rows = await positions(sql);
  const live: LivePosition[] = rows
    .filter((pos) => pos.status !== "closed")
    .map((pos) => ({
      pool: pos.pool,
      symbol: pos.symbol,
      name: pos.name,
      status: pos.status,
      upPct: upPct(pos.tokens, pos.price, pos.supraSpent),
      note:
        pos.status === "pending"
          ? "Buy submitted. Waiting for the balance."
          : pos.devSold
            ? "Creator sold. Exit in progress."
            : pos.graduated
              ? "Graduated. Selling the rest."
              : pos.hitDouble
                ? "Runner after the 60% sale."
                : "Full 50,000 clip. Watching the hour and the double.",
    }));
  const logs = await sql<Row>`select id, tone, symbol, text, tx_hash from operator_log order by id desc limit 12`;
  const balance = address ? formatSupra((await supraBalance(address)).toString()) : null;
  let onChain = false;
  if (address) {
    const res = await fetch(`${RPC}/rpc/v1/accounts/${address}`);
    const info = res.ok ? ((await res.json()) as { authentication_key?: string } | null) : null;
    onChain = Boolean(info && typeof info === "object" && info.authentication_key);
  }
  return {
    configured,
    address,
    balance,
    onChain,
    watchingFrom: watching == null ? null : Number(watching),
    positions: live,
    log: logs.map(
      (row): LiveLog => ({
        id: Number(row.id),
        tone: String(row.tone),
        symbol: String(row.symbol),
        text: String(row.text),
        txHash: row.tx_hash ? String(row.tx_hash) : null,
      }),
    ),
    note,
  };
}

export async function tickOperatorLive(): Promise<OperatorSnapshot> {
  const sql = await getSql();
  const now = Date.now();
  const locked = await sql`
    update operator_state set lock_until_ms = ${now + 45_000}
    where id = 1 and lock_until_ms < ${now}
    returning id
  `;
  if (!locked.length) return readOperator();
  try {
    let opened: OpenedWallet | null = null;
    try {
      opened = keypair();
    } catch {
      return readOperator();
    }
    if (!opened) return readOperator();
    const account = new SupraAccount(opened.seed);
    const address = opened.address;
    const head = await headHeight();
    const state = await sql<Row>`select cursor_height from operator_state where id = 1`;
    const cursor = state[0]?.cursor_height;
    if (cursor == null) {
      await sql`update operator_state set cursor_height = ${head} where id = 1`;
      await log(
        sql,
        "watch",
        "DESK",
        `Armed at block ${head}. Only Token Studio coins created after this block are bought.`,
      );
      return readOperator();
    }
    const start = Number(cursor);
    if (head > start) {
      const batches = await Promise.all([
        pullEvents("created", start, head),
        pullEvents("traded", start, head),
        pullEvents("completed", start, head),
      ]);
      const events = batches.flat().sort((a, b) => a.height - b.height || a.kind.localeCompare(b.kind));
      let openCount = (await positions(sql)).filter((pos) => pos.status === "open" || pos.status === "runner" || pos.status === "pending").length;
      let buys = 0;
      for (const event of events) {
        if (event.kind === "created" && buys < 3) {
          const next = await tryBuy(sql, account, address, openCount, event);
          if (next > openCount) buys += 1;
          openCount = next;
        } else if (event.kind === "traded" && event.data.is_buy === false) {
          const token = hex(event.data.token_address);
          const user = hex(event.data.user);
          if (token && user) {
            await sql`
              update operator_positions set dev_sold = true
              where token = ${token} and lower(creator) = ${user} and status in ('open', 'runner', 'pending')
            `;
          }
        } else if (event.kind === "completed") {
          const pool = hex(event.data.pool_address);
          if (pool) {
            await sql`update operator_positions set graduated = true where pool = ${pool} and status in ('open', 'runner')`;
          }
        }
      }
      const last = events.at(-1);
      const truncated = batches.some((batch) => batch.length >= 40);
      const nextCursor = truncated && last ? last.height : head;
      await sql`update operator_state set cursor_height = ${nextCursor} where id = 1`;
    }
    const book = await positions(sql);
    for (const pos of book) {
      if (pos.status === "closed") continue;
      await manage(sql, account, address, pos);
    }
  } catch (error) {
    await log(sql, "bad", "DESK", scrub(error instanceof Error ? error.message : "Tick failed"));
  } finally {
    await sql`update operator_state set lock_until_ms = 0 where id = 1`;
  }
  return readOperator();
}

export { readOperator };
