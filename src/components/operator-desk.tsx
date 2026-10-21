import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Pause, Play, RotateCcw } from "lucide-react";
import { getOperatorSnapshot, tickOperator } from "@/lib/operator.functions";
import type { OperatorSnapshot } from "@/lib/operator-types";
import {
  HOUR_MS,
  START_CASH,
  createBook,
  equityNow,
  findToken,
  fmtClock,
  fmtInt,
  fmtPx,
  fmtSigned,
  fmtTokens,
  spotMultiple,
  stepBook,
  unrealized,
  type Activity,
  type Book,
  type Lane,
  type Position,
} from "@/lib/operator-engine";

type Filter = "all" | Lane;
type ChainRow = { key: string; label: string; meta: string };

const SPEEDS = [1, 10, 30, 90];

export function OperatorDesk() {
  const bookRef = useRef<Book | null>(null);
  if (!bookRef.current) bookRef.current = createBook();
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [chainNote, setChainNote] = useState("Linking the Atmos indexer…");
  const [operator, setOperator] = useState<OperatorSnapshot | null>(null);

  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const book = bookRef.current;
      if (!book) return;
      const now = performance.now();
      let wall = now - last;
      last = now;
      if (wall > 1000) wall = 1000;
      if (!book.paused) stepBook(book, wall * book.speed);
      setTick((n) => n + 1);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const snap = await tickOperator();
        if (!stop) setOperator(snap);
      } catch {
        if (!stop) {
          try {
            const snap = await getOperatorSnapshot();
            if (!stop) setOperator(snap);
          } catch {
            if (!stop) setOperator(null);
          }
        }
      }
    }
    void pull();
    const id = window.setInterval(() => void pull(), 20000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const latestRes = await fetch("https://api.atmos.ag/stats/latest-block");
        if (!latestRes.ok) throw new Error("latest");
        const latest = (await latestRes.json()) as { block?: { blockNumber?: number } };
        const height = latest.block?.blockNumber;
        if (!height) throw new Error("height");
        const [evRes, poolRes] = await Promise.all([
          fetch(`https://api.atmos.ag/stats/events?fromBlock=${height - 40}&toBlock=${height}`),
          fetch("https://api.atmos.ag/stats/api/pools"),
        ]);
        if (!evRes.ok) throw new Error("events");
        const evJson = (await evRes.json()) as { events?: unknown[] };
        const poolJson = poolRes.ok ? ((await poolRes.json()) as { data?: { pools?: unknown[] } }) : {};
        const names = new Map<string, string>();
        for (const pool of poolJson.data?.pools ?? []) {
          const row = asRecord(pool);
          if (!row) continue;
          const addr = String(row.poolAddress ?? "");
          const coins = Array.isArray(row.coins) ? row.coins : [];
          const symbols = coins
            .map((coin) => {
              const c = asRecord(coin);
              const sym = String(c?.symbol ?? "");
              const short = sym.replace(/\s*\(.*\)/, "");
              return short || "token";
            })
            .slice(0, 2);
          if (addr && symbols.length) names.set(addr, symbols.join(" / "));
        }
        const rows: ChainRow[] = [];
        for (const raw of (evJson.events ?? []).slice(-6).reverse()) {
          const ev = asRecord(raw);
          if (!ev) continue;
          const pair = String(ev.pairId ?? "");
          const label = names.get(pair) ?? shortId(pair);
          const left = num(ev.asset0In);
          const right = num(ev.asset1Out);
          rows.push({
            key: `${ev.txnId ?? pair}-${ev.eventIndex ?? rows.length}`,
            label,
            meta: `${ev.eventType ?? "swap"} · in ${compactRaw(left)} · out ${compactRaw(right)}`,
          });
        }
        if (!stop) {
          setChain(rows);
          setChainNote(rows.length ? "Live Atmos mainnet swaps" : "No swaps in the last few blocks");
        }
      } catch {
        if (!stop) setChainNote("Atmos indexer is quiet from this page right now");
      }
    }
    void pull();
    const id = window.setInterval(() => void pull(), 15000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  const book = bookRef.current;
  void tick;
  const equity = equityNow(book);
  const openPnl = unrealized(book);
  const pnl = equity - START_CASH;
  const closed = book.stats.wins + book.stats.losses;
  const winRate = closed ? Math.round((book.stats.wins / closed) * 100) : 0;
  const studio = book.positions.filter((pos) => pos.lane === "studio");
  const agg = book.positions.filter((pos) => pos.lane === "aggregator");
  const activeId = picked && book.positions.some((pos) => pos.id === picked) ? picked : book.positions[0]?.id;
  const active = book.positions.find((pos) => pos.id === activeId);
  const activeToken = active ? findToken(book, active.tokenId) : undefined;
  const visible = book.log.filter((item) => filter === "all" || item.lane === filter || item.lane === "desk");

  function setSpeed(next: number) {
    book.speed = next;
    setTick((n) => n + 1);
  }

  function togglePause() {
    book.paused = !book.paused;
    setTick((n) => n + 1);
  }

  function reset() {
    bookRef.current = createBook();
    setPicked(null);
    setTick((n) => n + 1);
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-mint text-sm font-semibold text-ink">
              Op
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Operator</h1>
              <p className="text-sm text-muted">Atmos Token Studio sniper and aggregator revival desk</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-surface p-1">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSpeed(value)}
                className={
                  "h-11 min-w-11 rounded-md px-3 font-mono text-sm " +
                  (book.speed === value ? "bg-mint text-ink" : "text-muted")
                }
              >
                {value}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={togglePause}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm"
          >
            {book.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {book.paused ? "Resume" : "Pause"}
          </button>
          <a
            href="/operator-source.zip"
            download="operator-source.zip"
            className="inline-flex h-11 items-center rounded-lg bg-mint px-4 text-sm font-medium text-ink"
          >
            Download source
          </a>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>
      </header>

        <p className="mt-4 max-w-3xl text-sm text-muted">
          The live wallet trades Token Studio on its own once the server is holding the key. The practice clock
          below is a sped-up rehearsal and does not spend SUPRA. At {book.speed}×, one practice hour is{" "}
          {hourLabel(book.speed)}.
        </p>

      <LiveWallet snap={operator} />

      <h2 className="mt-6 text-sm font-medium text-muted">Practice clock</h2>

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Session PnL" value={`${fmtSigned(pnl)} SUPRA`} hint={`equity ${fmtInt(equity)}`} hot={pnl >= 0} />
        <Stat label="Treasury free" value={fmtInt(book.cash)} hint="SUPRA not in a clip" />
        <Stat label="Realized" value={fmtSigned(book.realized)} hint="closed legs" hot={book.realized >= 0} />
        <Stat label="Open PnL" value={fmtSigned(openPnl)} hint="if sold now, after fees" hot={openPnl >= 0} />
        <Stat label="Open clips" value={String(book.positions.length)} hint={`${studio.length} studio · ${agg.length} agg`} />
        <Stat label="Win rate" value={closed ? `${winRate}%` : "—"} hint={`${book.stats.wins} won · ${book.stats.losses} lost`} />
      </section>

      <section className="mt-4 h-28 rounded-lg border border-line bg-surface px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={book.equity.map((point) => ({ v: Math.round(point.v) }))}>
            <YAxis hide domain={["dataMin - 1000", "dataMax + 1000"]} />
            <Area
              type="monotone"
              dataKey="v"
              stroke="var(--color-mint)"
              fill="var(--color-mint)"
              fillOpacity={0.18}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)]">
        <section className="order-2 space-y-4 lg:order-1">
          <PositionGroup
            title="Token Studio"
            hint="50,000 SUPRA on every new deploy"
            book={book}
            rows={studio}
            activeId={activeId}
            onPick={setPicked}
          />
          <PositionGroup
            title="Aggregator"
            hint="Sized to the revival, never above 50,000"
            book={book}
            rows={agg}
            activeId={activeId}
            onPick={setPicked}
          />
          {active && activeToken ? (
            <article className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                  {active.symbol}
                  <span className="ml-2 text-sm font-normal text-muted">{active.name}</span>
                </h2>
                <p className="font-mono text-sm text-muted">{fmtPx(activeToken.price)}</p>
              </div>
              <p className="mt-2 text-sm text-muted">{active.note}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Mini k="Avg entry" v={fmtPx(active.entryPrice)} />
                <Mini k="Bag" v={fmtTokens(active.tokens)} />
                <Mini k="Cost left" v={fmtInt(active.remainingCost)} />
                <Mini k="Realized here" v={fmtSigned(active.realized)} />
              </dl>
              <div className="mt-3 h-16">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activeToken.spark.map((v) => ({ v }))}>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="var(--color-mint)"
                      fill="var(--color-mint)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>
          ) : null}
          <details className="rounded-lg border border-line bg-surface">
            <summary className="px-4 py-3 text-sm font-medium">Playbook</summary>
            <div className="grid gap-4 border-t border-line px-4 py-4 text-sm text-muted sm:grid-cols-2">
              <div>
                <h3 className="font-medium text-fg">Token Studio — always 50,000 SUPRA</h3>
                <ul className="mt-2 space-y-2">
                  <li>New deploy: buy instantly.</li>
                  <li>Spot doubles from your average: sell 60% that second.</li>
                  <li>The 40% runner stays for graduation, a +250% trim, or a 25% giveback from the peak — whichever hits first.</li>
                  <li>Sixty minutes with no double: sell everything.</li>
                  <li>Creator sells: dump 100% of whatever is left.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-fg">Aggregator — cap 50,000 SUPRA</h3>
                <ul className="mt-2 space-y-2">
                  <li>Only after a 28%+ dump that is sitting on a prior low.</li>
                  <li>Buyers have to come back: three or more buy prints, buy volume leads, and a higher low.</li>
                  <li>Size follows how clean the setup is. Five checks lining up is the full 50,000.</li>
                  <li>+80% sells 60% and trails the rest by 20%. Support break, a 45-minute stall, or a dev sale exits the rest.</li>
                </ul>
              </div>
            </div>
          </details>
        </section>

        <aside className="order-1 lg:order-2">
          <div className="rounded-lg border border-line bg-surface lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Activity</h2>
              <div className="flex gap-1">
                {(
                  [
                    ["all", "All"],
                    ["studio", "Studio"],
                    ["aggregator", "Agg"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={
                      "h-11 rounded-md px-3 text-xs " +
                      (filter === id ? "bg-mint text-ink" : "text-muted")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="max-h-[28rem] overflow-auto px-4">
              {visible.length === 0 ? (
                <li className="py-6 text-sm text-muted">Quiet tape.</li>
              ) : (
                visible.map((item) => <ActivityRow key={item.id} item={item} />)
              )}
            </ul>
            <div className="border-t border-line px-4 py-3">
              <p className="text-xs font-medium text-fg">{chainNote}</p>
              <ul className="mt-2 space-y-2">
                {chain.map((row) => (
                  <li key={row.key} className="text-xs text-muted">
                    <span className="text-fg">{row.label}</span>
                    <span className="mt-0.5 block font-mono">{row.meta}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function hourLabel(speed: number): string {
  const seconds = Math.round(3600 / speed);
  if (seconds >= 90) return `${Math.round(seconds / 60)} min`;
  return `${seconds} sec`;
}

function Stat({
  label,
  value,
  hint,
  hot,
}: {
  label: string;
  value: string;
  hint: string;
  hot?: boolean;
}) {
  return (
    <article className="rounded-lg border border-line bg-surface px-3 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={"mt-1 font-mono text-lg " + (hot === undefined ? "text-fg" : hot ? "text-mint" : "text-rose")}>
        {value}
      </p>
      <p className="text-xs text-muted">{hint}</p>
    </article>
  );
}

function PositionGroup({
  title,
  hint,
  book,
  rows,
  activeId,
  onPick,
}: {
  title: string;
  hint: string;
  book: Book;
  rows: Position[];
  activeId?: string;
  onPick: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
          Nothing open. The desk is still watching.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((pos) => (
            <li key={pos.id}>
              <PositionCard book={book} pos={pos} active={pos.id === activeId} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PositionCard({
  book,
  pos,
  active,
  onPick,
}: {
  book: Book;
  pos: Position;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const mult = spotMultiple(book, pos);
  const spot = (mult - 1) * 100;
  const token = findToken(book, pos.tokenId);
  const net = (token ? quoteSafe(book, pos) : 0) - pos.remainingCost;
  const age = book.strategyMs - pos.openedAt;
  const left = Math.max(0, HOUR_MS - age);
  const toDouble = Math.max(0, Math.min(100, ((mult - 1) / 1) * 100));
  return (
    <button
      type="button"
      onClick={() => onPick(pos.id)}
      className={
        "w-full rounded-lg border p-4 text-left " +
        (active ? "border-mint bg-surface" : "border-line bg-surface")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {pos.symbol}
            <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted">
              {pos.status === "runner" ? "Runner" : pos.lane === "studio" ? "Full clip" : "Revival"}
            </span>
          </p>
          <p className="text-xs text-muted">
            age {fmtClock(age)}
            {pos.lane === "studio" && !pos.hitDouble ? ` · timeout ${fmtClock(left)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className={"font-mono text-lg " + (spot >= 0 ? "text-mint" : "text-rose")}>
            {spot >= 0 ? "+" : "−"}
            {Math.abs(spot).toFixed(1)}%
          </p>
          <p className={"font-mono text-xs " + (net >= 0 ? "text-mint" : "text-rose")}>{fmtSigned(net)} net</p>
        </div>
      </div>
      {pos.lane === "studio" && !pos.hitDouble ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Path to +100%</span>
            <span>{Math.round(toDouble)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <div className="h-1.5 rounded-full bg-mint" style={{ width: `${toDouble}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">{pos.note}</p>
      )}
    </button>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  const tone =
    item.tone === "buy" || item.tone === "good"
      ? "text-mint"
      : item.tone === "bad"
        ? "text-rose"
        : item.tone === "sell"
          ? "text-fg"
          : "text-muted";
  return (
    <li className="grid grid-cols-[4.2rem_minmax(0,1fr)] gap-3 border-b border-line py-3">
      <time className="font-mono text-xs text-muted">{fmtClock(item.at)}</time>
      <div>
        <p className={"text-sm " + tone}>{item.text}</p>
        {item.pnl !== undefined ? (
          <p className={"mt-1 font-mono text-xs " + (item.pnl >= 0 ? "text-mint" : "text-rose")}>
            {fmtSigned(item.pnl)} SUPRA · received {fmtInt(item.supra ?? 0)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function LiveWallet({ snap }: { snap: OperatorSnapshot | null }) {
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Live wallet</h2>
        <p className="text-xs text-muted">Server key · Supra mainnet · not shown here</p>
      </div>
      {!snap ? (
        <p className="mt-3 text-sm text-muted">Reading the operator…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted">{snap.note}</p>
          {snap.address ? (
            <p className="break-all font-mono text-xs text-fg">{snap.address}</p>
          ) : (
            <p className="text-sm text-fg">
              Set <span className="font-mono">SUPRA_PRIVATE_KEY</span> in the Vercel project environment, then
              publish again. Use the 32-byte hex private key. Do not put it in the page.
            </p>
          )}
          {snap.address ? (
            <p className="text-sm text-muted">
              {snap.onChain ? "Account is on mainnet." : "No account on mainnet yet. Fund it before it can buy."}
              {snap.balance !== null ? ` Balance ${snap.balance} SUPRA.` : ""}
              {snap.watchingFrom !== null ? ` Watching from block ${snap.watchingFrom}.` : " Not armed on a block yet."}
            </p>
          ) : null}
          {snap.positions.length ? (
            <ul className="space-y-2">
              {snap.positions.map((pos) => (
                <li key={pos.pool} className="rounded-md border border-line px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">
                      {pos.symbol}
                      <span className="ml-2 text-xs font-normal uppercase text-muted">{pos.status}</span>
                    </p>
                    <p className={"font-mono text-sm " + ((pos.upPct ?? 0) >= 0 ? "text-mint" : "text-rose")}>
                      {pos.upPct === null ? "—" : `${pos.upPct >= 0 ? "+" : ""}${pos.upPct.toFixed(1)}%`}
                    </p>
                  </div>
                  <p className="text-xs text-muted">{pos.note}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {snap.log.length ? (
            <ul className="border-t border-line pt-2">
              {snap.log.map((row) => (
                <li key={row.id} className="py-1.5 text-sm">
                  <span className={row.tone === "bad" ? "text-rose" : row.tone === "buy" ? "text-mint" : "text-fg"}>
                    {row.symbol} · {row.text}
                  </span>
                  {row.txHash ? (
                    <span className="mt-0.5 block font-mono text-xs text-muted">
                      {row.txHash.slice(0, 10)}…{row.txHash.slice(-6)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted">
            Live authority is Token Studio only: 50,000 SUPRA in, 60% out at a double, runner for graduation or a
            better exit, full sell at one hour or if the creator sells. Aggregator revivals stay on the practice
            clock. The swap route is too easy to get wrong, and a wrong call would spend real SUPRA.
          </p>
        </div>
      )}
    </section>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-mono text-sm">{v}</dd>
    </div>
  );
}

function quoteSafe(book: Book, pos: Position): number {
  const token = findToken(book, pos.tokenId);
  if (!token) return 0;
  const price = token.price;
  if (token.kind === "listed") {
    const gross = pos.tokens * price;
    const impact = Math.min(0.12, gross / 2_000_000);
    return gross * (1 - 0.003) * (1 - impact * 0.5);
  }
  const k = token.vToken * token.vSupra;
  const newVT = token.vToken + pos.tokens;
  const newVS = k / newVT;
  const gross = token.vSupra - newVS;
  return Math.max(0, gross) * 0.99;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function compactRaw(value: number): string {
  if (value <= 0) return "0";
  const whole = value / 1e8;
  if (whole >= 1) return fmtInt(whole);
  return whole.toFixed(4);
}

function shortId(id: string): string {
  if (id.length < 12) return id || "pair";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
