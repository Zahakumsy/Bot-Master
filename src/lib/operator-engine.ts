/** Paper operator for Atmos Token Studio + the swap aggregator. */

export const STUDIO_CLIP = 50_000;
export const AGG_MAX = 50_000;
export const HOUR_MS = 60 * 60 * 1000;
export const START_CASH = 1_500_000;
const FEE = 0.01;
const V_TOKEN = 1_000_000_000;
const V_SUPRA = 212_500;
const STEP_MS = 2_000;

export type Lane = "studio" | "aggregator";
export type Tone = "buy" | "sell" | "good" | "bad" | "wait" | "info";
export type Archetype = "chop" | "pump" | "rug" | "moon";

export type Activity = {
  id: number;
  at: number;
  lane: Lane | "desk";
  tone: Tone;
  symbol: string;
  text: string;
  supra?: number;
  pnl?: number;
};

export type Position = {
  id: string;
  tokenId: string;
  lane: Lane;
  symbol: string;
  name: string;
  openedAt: number;
  entryPrice: number;
  tokens: number;
  remainingCost: number;
  realized: number;
  status: "open" | "runner";
  hitDouble: boolean;
  trimmed: boolean;
  peak: number;
  support?: number;
  note: string;
};

export type StudioToken = {
  kind: "studio";
  id: string;
  symbol: string;
  name: string;
  creator: string;
  archetype: Archetype;
  born: number;
  vToken: number;
  vSupra: number;
  price: number;
  raised: number;
  devTokens: number;
  marketTokens: number;
  devSold: boolean;
  graduated: boolean;
  sniped: boolean;
  anchor: number;
  spark: number[];
};

export type ListedToken = {
  kind: "listed";
  id: string;
  symbol: string;
  name: string;
  creator: string;
  born: number;
  base: number;
  price: number;
  peak: number;
  support: number;
  devSold: boolean;
  sniped: boolean;
  prints: { side: "buy" | "sell"; supra: number }[];
  spark: number[];
  watchNoteAt: number;
  lastReason: string;
};

export type Token = StudioToken | ListedToken;

export type EquityPoint = { s: number; v: number };

export type Book = {
  cash: number;
  realized: number;
  strategyMs: number;
  speed: number;
  paused: boolean;
  rngState: number;
  nextId: number;
  tokens: Token[];
  positions: Position[];
  log: Activity[];
  equity: EquityPoint[];
  lastEquityAt: number;
  stats: {
    wins: number;
    losses: number;
    timeouts: number;
    devExits: number;
    grads: number;
    partials: number;
  };
};

const NAMES: [string, string][] = [
  ["Keel", "KEEL"],
  ["Mossbit", "MOSS"],
  ["Nimbus", "NMBS"],
  ["Cinder", "CNDR"],
  ["Quartz", "QRZ"],
  ["Vapor", "VAPR"],
  ["Flint", "FLNT"],
  ["Orbit", "ORBT"],
  ["Lumen", "LUMN"],
  ["Drift", "DRFT"],
  ["Ember", "EMBR"],
  ["Axiom", "AXM"],
  ["Pebble", "PBBL"],
  ["Rift", "RIFT"],
  ["Glow", "GLOW"],
  ["Byte", "BYTE"],
  ["Volt", "VOLT"],
  ["Nova", "NOVA"],
  ["Drip", "DRIP"],
  ["Hazel", "HZL"],
];

export function createBook(): Book {
  const book: Book = {
    cash: START_CASH,
    realized: 0,
    strategyMs: 80 * 60 * 1000,
    speed: 10,
    paused: false,
    rngState: 0xa70a5,
    nextId: 1,
    tokens: [],
    positions: [],
    log: [],
    equity: [],
    lastEquityAt: 0,
    stats: { wins: 0, losses: 0, timeouts: 0, devExits: 0, grads: 0, partials: 0 },
  };
  pushLog(book, {
    at: book.strategyMs,
    lane: "desk",
    tone: "info",
    symbol: "DESK",
    text: "Operator armed. Paper treasury is live — rules run on every launch and every revival.",
  });
  spawnStudio(book, { archetype: "chop", ageMs: 50 * 60 * 1000, name: "Pebble", symbol: "PBBL" });
  spawnStudio(book, { archetype: "pump", ageMs: 6 * 60 * 1000, name: "Cinder", symbol: "CNDR" });
  spawnStudio(book, { archetype: "rug", ageMs: 3 * 60 * 1000, name: "Vapor", symbol: "VAPR" });
  spawnListed(book, { ageMs: 26 * 60 * 1000, name: "Orbit", symbol: "ORBT", base: 0.0042 });
  spawnListed(book, { ageMs: 12 * 60 * 1000, name: "Rift", symbol: "RIFT", base: 0.0031 });
  book.lastEquityAt = 0;
  sampleEquity(book, true);
  return book;
}

export function stepBook(book: Book, strategyDt: number): void {
  let left = strategyDt;
  let guard = 0;
  while (left > 0 && guard < 80) {
    const dt = Math.min(STEP_MS, left);
    book.strategyMs += dt;
    for (const token of book.tokens) {
      if (token.kind === "studio") advanceStudio(book, token);
      else advanceListed(book, token);
    }
    for (let i = book.positions.length - 1; i >= 0; i--) {
      evaluate(book, book.positions[i]!);
    }
    maybeSpawn(book);
    sampleEquity(book, false);
    left -= dt;
    guard++;
  }
}

export function equityNow(book: Book): number {
  return book.cash + book.positions.reduce((sum, pos) => sum + markOf(book, pos), 0);
}

export function unrealized(book: Book): number {
  return book.positions.reduce((sum, pos) => sum + markOf(book, pos) - pos.remainingCost, 0);
}

export function spotMultiple(book: Book, pos: Position): number {
  const token = findToken(book, pos.tokenId);
  if (!token || pos.entryPrice <= 0) return 1;
  return token.price / pos.entryPrice;
}

export function findToken(book: Book, id: string): Token | undefined {
  return book.tokens.find((token) => token.id === id);
}

function maybeSpawn(book: Book): void {
  const studioOpen = book.positions.filter((pos) => pos.lane === "studio").length;
  const roll = nextRand(book);
  if (roll < 0.0045) {
    if (studioOpen >= 6 || book.cash < STUDIO_CLIP) {
      if (roll < 0.004) {
        pushLog(book, {
          at: book.strategyMs,
          lane: "studio",
          tone: "wait",
          symbol: "STUDIO",
          text:
            book.cash < STUDIO_CLIP
              ? "New Token Studio deploy seen — treasury can't cover a 50,000 SUPRA clip."
              : "New deploy seen — six studio clips already open, standing aside until one closes.",
        });
      }
    } else {
      const archetypes: Archetype[] = ["chop", "pump", "pump", "rug", "moon", "chop"];
      const archetype = archetypes[Math.floor(nextRand(book) * archetypes.length)]!;
      spawnStudio(book, { archetype, ageMs: 0 });
    }
  }
  if (nextRand(book) < 0.006) {
    const listedOpen = book.tokens.filter((token) => token.kind === "listed").length;
    if (listedOpen < 5) spawnListed(book, { ageMs: 0 });
  }
}

function spawnStudio(
  book: Book,
  opts: { archetype: Archetype; ageMs: number; name?: string; symbol?: string },
): void {
  const picked = pickName(book, opts.name, opts.symbol);
  const born = book.strategyMs - opts.ageMs;
  const token: StudioToken = {
    kind: "studio",
    id: `s${book.nextId++}`,
    symbol: picked.symbol,
    name: picked.name,
    creator: creatorAddr(book.nextId * 17 + 3),
    archetype: opts.archetype,
    born,
    vToken: V_TOKEN,
    vSupra: V_SUPRA,
    price: V_SUPRA / V_TOKEN,
    raised: 0,
    devTokens: 0,
    marketTokens: 0,
    devSold: false,
    graduated: false,
    sniped: false,
    anchor: V_SUPRA / V_TOKEN,
    spark: [],
  };
  book.tokens.unshift(token);
  token.devTokens = curveBuy(token, 18_000);
  snipeStudio(book, token, born);
  token.anchor = token.price;
  if (opts.ageMs > 0) {
    for (let i = 0; i < 100; i++) syncStudioPrice(token, opts.ageMs / 60000);
  }
  book.tokens = book.tokens.slice(0, 16);
}

function snipeStudio(book: Book, token: StudioToken, at: number): void {
  if (token.sniped) return;
  token.sniped = true;
  if (book.cash < STUDIO_CLIP) {
    pushLog(book, {
      at,
      lane: "studio",
      tone: "wait",
      symbol: token.symbol,
      text: `${token.symbol} deployed — skipped, treasury below 50,000 SUPRA.`,
    });
    return;
  }
  const tokens = curveBuy(token, STUDIO_CLIP);
  if (tokens <= 0) return;
  book.cash -= STUDIO_CLIP;
  const entry = STUDIO_CLIP / tokens;
  const pos: Position = {
    id: `p${book.nextId++}`,
    tokenId: token.id,
    lane: "studio",
    symbol: token.symbol,
    name: token.name,
    openedAt: at,
    entryPrice: entry,
    tokens,
    remainingCost: STUDIO_CLIP,
    realized: 0,
    status: "open",
    hitDouble: false,
    trimmed: false,
    peak: token.price,
    note: "Sniped 50,000 SUPRA the moment it deployed",
  };
  book.positions.unshift(pos);
  token.spark.push(token.price);
  pushLog(book, {
    at,
    lane: "studio",
    tone: "buy",
    symbol: token.symbol,
    text: `New Token Studio deploy — bought 50,000 SUPRA of ${token.symbol}.`,
    supra: -STUDIO_CLIP,
  });
}

function spawnListed(
  book: Book,
  opts: { ageMs: number; name?: string; symbol?: string; base?: number },
): void {
  const picked = pickName(book, opts.name, opts.symbol);
  const base = opts.base ?? 0.002 + nextRand(book) * 0.006;
  const token: ListedToken = {
    kind: "listed",
    id: `l${book.nextId++}`,
    symbol: picked.symbol,
    name: picked.name,
    creator: creatorAddr(book.nextId * 29 + 11),
    born: book.strategyMs - opts.ageMs,
    base,
    price: base,
    peak: base,
    support: base * 0.7,
    devSold: false,
    sniped: false,
    prints: [],
    spark: [],
    watchNoteAt: 0,
    lastReason: "",
  };
  syncListed(token, opts.ageMs / 60000, true);
  book.tokens.unshift(token);
  book.tokens = book.tokens.slice(0, 16);
  if (opts.ageMs === 0) {
    pushLog(book, {
      at: book.strategyMs,
      lane: "aggregator",
      tone: "info",
      symbol: token.symbol,
      text: `${token.symbol} is on the aggregator tape. Waiting for a dump into support and buyers to return.`,
    });
  }
}

function advanceStudio(book: Book, token: StudioToken): void {
  if (token.graduated) return;
  const age = ageMin(book, token);
  if (token.archetype === "rug" && age >= 8 && !token.devSold) {
    const devSell = token.devTokens * 0.9;
    token.devTokens -= devSell;
    if (devSell > 0) curveSell(token, devSell);
    const dump = token.marketTokens * 0.55;
    token.marketTokens -= dump;
    if (dump > 0) curveSell(token, dump);
    token.devSold = true;
    token.spark.push(token.price);
    if (token.spark.length > 56) token.spark.shift();
    pushLog(book, {
      at: book.strategyMs,
      lane: "studio",
      tone: "bad",
      symbol: token.symbol,
      text: `Creator ${shortAddr(token.creator)} sold ${token.symbol}. Dev-sell kill switch is live.`,
    });
    return;
  }
  if (token.archetype === "moon" && age >= 34 && !token.graduated) {
    token.graduated = true;
    token.raised = Math.max(token.raised, 855_000);
    if (book.positions.some((pos) => pos.tokenId === token.id)) {
      pushLog(book, {
        at: book.strategyMs,
        lane: "studio",
        tone: "good",
        symbol: token.symbol,
        text: `${token.symbol} filled the curve and is graduating to the DEX.`,
      });
    }
    return;
  }
  syncStudioPrice(token, age);
}

function syncStudioPrice(token: StudioToken, age: number): void {
  const target = studioTarget(token, age);
  if (target <= 0) return;
  const ratio = target / Math.max(token.price, 1e-12);
  if (ratio > 1.008) {
    const grow = Math.min(ratio - 1, 0.012);
    const net = token.vSupra * (Math.sqrt(1 + grow) - 1);
    const got = curveBuy(token, net / (1 - FEE));
    token.marketTokens += got;
  } else if (ratio < 0.992 && token.marketTokens > 1000) {
    const drop = Math.min(1 - ratio, 0.012);
    const frac = Math.min(0.2, drop * 3);
    const amt = token.marketTokens * frac;
    token.marketTokens -= amt;
    curveSell(token, amt);
  }
  token.spark.push(token.price);
  if (token.spark.length > 56) token.spark.shift();
}

function studioTarget(token: StudioToken, age: number): number {
  const anchor = token.anchor || token.price;
  if (token.archetype === "chop") return anchor * (1.02 + 0.12 * Math.sin(age / 4));
  if (token.archetype === "pump") {
    if (age < 14) return anchor * (1 + (age / 14) * 0.95);
    if (age < 30) return anchor * (1.95 - ((age - 14) / 16) * 0.6);
    return anchor * 1.3;
  }
  if (token.archetype === "rug") {
    return age < 8 ? anchor * (1 + (age / 8) * 0.4) : anchor * 0.72;
  }
  if (age < 12) return anchor * (1 + (age / 12) * 1.05);
  if (age < 34) return anchor * (2.05 + ((age - 12) / 22) * 1.5);
  return anchor * 3.5;
}

function advanceListed(book: Book, token: ListedToken): void {
  const age = ageMin(book, token);
  const before = token.price;
  syncListed(token, age, false);
  const delta = token.price - before;
  if (age >= 8 && age < 16) token.prints.push({ side: "sell", supra: 18_000 });
  else if (age >= 16 && age < 28) {
    token.prints.push({ side: Math.sin(age * 3) > 0 ? "buy" : "sell", supra: 3_500 });
  } else if (age >= 28 && age < 50) {
    token.prints.push({ side: "buy", supra: 12_000 + (age - 28) * 300 });
  } else if (delta < 0) token.prints.push({ side: "sell", supra: 8_000 });
  if (token.prints.length > 24) token.prints.splice(0, token.prints.length - 24);
  if (age >= 62 && !token.devSold) {
    token.devSold = true;
    pushLog(book, {
      at: book.strategyMs,
      lane: "aggregator",
      tone: "bad",
      symbol: token.symbol,
      text: `Dev wallet sold ${token.symbol} on the aggregator book.`,
    });
  }
  considerAggEntry(book, token, age);
}

function syncListed(token: ListedToken, age: number, prefill: boolean): void {
  const mult = listedMult(age);
  token.price = token.base * mult;
  token.peak = Math.max(token.peak, token.base * 1.25, token.price);
  token.support = token.base * 0.7;
  token.spark.push(token.price);
  if (token.spark.length > 56) token.spark.shift();
  if (prefill) {
    token.prints = [
      { side: "sell", supra: 22_000 },
      { side: "sell", supra: 16_000 },
      { side: "sell", supra: 19_000 },
      { side: "buy", supra: 3_200 },
      { side: "sell", supra: 9_000 },
      { side: "buy", supra: 2_400 },
    ];
  }
}

function listedMult(age: number): number {
  if (age < 8) return 1 + (age / 8) * 0.25;
  if (age < 16) return 1.25 - ((age - 8) / 8) * 0.55;
  if (age < 28) return 0.7 + 0.008 * Math.sin(age * 1.3);
  if (age < 36) return 0.708 + ((age - 28) / 8) * 0.08;
  if (age < 52) return 0.788 + ((age - 36) / 16) * 0.95;
  if (age < 62) return 1.74 - ((age - 52) / 10) * 0.55;
  return 1.05;
}

function considerAggEntry(book: Book, token: ListedToken, age: number): void {
  if (token.sniped || token.devSold) return;
  if (book.positions.some((pos) => pos.tokenId === token.id)) return;
  const read = readRevival(token);
  if (read.buy) {
    const size = clipForScore(read.score);
    if (book.cash < size) {
      pushLog(book, {
        at: book.strategyMs,
        lane: "aggregator",
        tone: "wait",
        symbol: token.symbol,
        text: `${token.symbol} revival is real, but treasury can't fund ${fmtInt(size)} SUPRA.`,
      });
      token.sniped = true;
      return;
    }
    const { tokens, avg } = listedFillBuy(token.price, size);
    token.price *= 1 + size / 2_000_000;
    book.cash -= size;
    token.sniped = true;
    const pos: Position = {
      id: `p${book.nextId++}`,
      tokenId: token.id,
      lane: "aggregator",
      symbol: token.symbol,
      name: token.name,
      openedAt: book.strategyMs,
      entryPrice: avg,
      tokens,
      remainingCost: size,
      realized: 0,
      status: "open",
      hitDouble: false,
      trimmed: false,
      peak: token.price,
      support: token.support,
      note: read.reason,
    };
    book.positions.unshift(pos);
    pushLog(book, {
      at: book.strategyMs,
      lane: "aggregator",
      tone: "buy",
      symbol: token.symbol,
      text: `Revival on ${token.symbol} — bought ${fmtInt(size)} SUPRA. ${read.reason}`,
      supra: -size,
    });
    return;
  }
  if (
    !read.buy &&
    read.reason !== token.lastReason &&
    book.strategyMs - token.watchNoteAt > 3 * 60 * 1000 &&
    age > 6 &&
    age < 55
  ) {
    token.watchNoteAt = book.strategyMs;
    token.lastReason = read.reason;
    pushLog(book, {
      at: book.strategyMs,
      lane: "aggregator",
      tone: "wait",
      symbol: token.symbol,
      text: read.reason,
    });
  }
}

function readRevival(token: ListedToken): { buy: boolean; score: number; reason: string } {
  const dd = token.peak > 0 ? (token.peak - token.price) / token.peak : 0;
  const dumped = dd >= 0.28;
  const near = token.price <= token.support * 1.16 && token.price >= token.support * 0.97;
  const last = token.prints.slice(-8);
  const buys = last.filter((print) => print.side === "buy");
  const buyVol = buys.reduce((sum, print) => sum + print.supra, 0);
  const sellVol = last
    .filter((print) => print.side === "sell")
    .reduce((sum, print) => sum + print.supra, 0);
  const buyers = buys.length >= 3 && buyVol > sellVol * 1.15;
  const recent = token.spark.slice(-8);
  const low = recent.length ? Math.min(...recent) : token.price;
  const higherLow = token.price >= low * 1.006 && token.price <= token.support * 1.25;
  const quiet = !token.devSold;
  const flags = [dumped, near, buyers, higherLow, quiet];
  const score = flags.filter(Boolean).length;
  const buy = dumped && near && buyers && higherLow && quiet;
  let reason = `${token.symbol} scanning`;
  if (!dumped) reason = `${token.symbol} has not dumped into a level worth bidding.`;
  else if (!near && token.price < token.support * 0.985)
    reason = `${token.symbol} lost major support — standing down.`;
  else if (!near) reason = `${token.symbol} dumped, but it is not sitting on support yet.`;
  else if (!buyers) reason = `${token.symbol} is on support. Buyers are not back — no bid.`;
  else if (!higherLow) reason = `${token.symbol} has buyers, still waiting for a higher low.`;
  else reason = `Dump held, ${buys.length} buy prints lead volume, higher low in. Score ${score}/5.`;
  return { buy, score, reason };
}

function clipForScore(score: number): number {
  if (score >= 5) return AGG_MAX;
  if (score === 4) return 35_000;
  return 22_000;
}

function evaluate(book: Book, pos: Position): void {
  const token = findToken(book, pos.tokenId);
  if (!token || pos.tokens <= 1) return;
  const price = token.price;
  pos.peak = Math.max(pos.peak, price);
  const up = price / pos.entryPrice;

  if (token.devSold) {
    sellFrac(book, token, pos, 1, `${token.symbol} dev sold — exited 100% of the bag.`);
    book.stats.devExits += 1;
    return;
  }

  if (token.kind === "studio" && token.graduated) {
    sellFrac(book, token, pos, 1, `${token.symbol} graduated — sold the remaining bag into migration.`);
    book.stats.grads += 1;
    return;
  }

  if (pos.lane === "studio") {
    const age = book.strategyMs - pos.openedAt;
    if (!pos.hitDouble && up >= 2) {
      sellFrac(book, token, pos, 0.6, `${token.symbol} is up 100% — sold 60%. Runner stays for graduation or a better exit.`);
      pos.hitDouble = true;
      pos.status = "runner";
      pos.peak = token.price;
      pos.trimmed = false;
      pos.note = "60% off at the double. Runner is live.";
      book.stats.partials += 1;
      return;
    }
    if (!pos.hitDouble && age >= HOUR_MS) {
      sellFrac(book, token, pos, 1, `${token.symbol} spent 60 minutes and never doubled — sold 100%.`);
      book.stats.timeouts += 1;
      return;
    }
    if (pos.hitDouble && !pos.trimmed && up >= 3.5) {
      sellFrac(
        book,
        token,
        pos,
        0.5,
        `${token.symbol} runner is up 250% from entry — trimmed half. Moonbag rides to graduation or the trail.`,
      );
      pos.trimmed = true;
      pos.note = "Banked extra runner profit. Moonbag still on.";
      return;
    }
    if (pos.hitDouble && price <= pos.peak * 0.75) {
      sellFrac(book, token, pos, 1, `${token.symbol} runner gave back 25% from its peak — banked the rest.`);
      return;
    }
    return;
  }

  const support = pos.support ?? 0;
  const age = book.strategyMs - pos.openedAt;
  if (support > 0 && price < support * 0.97) {
    sellFrac(book, token, pos, 1, `${token.symbol} broke support — revival thesis is dead, sold 100%.`);
    return;
  }
  if (!pos.hitDouble && up >= 1.8) {
    sellFrac(book, token, pos, 0.6, `${token.symbol} revival paid +80% — sold 60% and left a trailed runner.`);
    pos.hitDouble = true;
    pos.status = "runner";
    pos.peak = token.price;
    pos.note = "Aggregator partial booked. Trailing the rest.";
    book.stats.partials += 1;
    return;
  }
  if (!pos.hitDouble && age >= 45 * 60 * 1000 && up < 1.18) {
    sellFrac(book, token, pos, 1, `${token.symbol} revival stalled for 45 minutes — sold the clip.`);
    return;
  }
  if (pos.hitDouble && price <= pos.peak * 0.8) {
    sellFrac(book, token, pos, 1, `${token.symbol} aggregator trail (20% off peak) hit — sold the runner.`);
  }
}

function sellFrac(book: Book, token: Token, pos: Position, frac: number, text: string): void {
  const portion = Math.min(1, Math.max(0, frac));
  const selling = pos.tokens * (portion >= 0.999 ? 1 : portion);
  if (selling <= 1) return;
  const cost = pos.remainingCost * (selling / pos.tokens);
  let proceeds = 0;
  if (token.kind === "studio") proceeds = curveSell(token, selling);
  else proceeds = listedFillSell(token.price, selling);
  if (token.kind === "listed") token.price *= 1 - (proceeds / 2_000_000) * 0.5;
  pos.tokens -= selling;
  pos.remainingCost -= cost;
  const pnl = proceeds - cost;
  pos.realized += pnl;
  book.realized += pnl;
  book.cash += proceeds;
  token.spark.push(token.price);
  const tone: Tone = pnl >= 0 ? "sell" : "bad";
  pushLog(book, {
    at: book.strategyMs,
    lane: pos.lane,
    tone,
    symbol: pos.symbol,
    text,
    supra: proceeds,
    pnl,
  });
  if (pos.tokens <= 1) {
    pos.tokens = 0;
    pos.remainingCost = 0;
    pos.note = text;
    if (pos.realized >= 0) book.stats.wins += 1;
    else book.stats.losses += 1;
    book.positions = book.positions.filter((item) => item.id !== pos.id);
  }
}

function markOf(book: Book, pos: Position): number {
  const token = findToken(book, pos.tokenId);
  if (!token || pos.tokens <= 0) return 0;
  if (token.kind === "studio") return quoteCurveSell(token, pos.tokens);
  return listedFillSell(token.price, pos.tokens);
}

function curveBuy(token: StudioToken, gross: number): number {
  if (!(gross > 1)) return 0;
  const net = gross * (1 - FEE);
  const k = token.vToken * token.vSupra;
  const newVS = token.vSupra + net;
  const newVT = k / newVS;
  const out = token.vToken - newVT;
  if (!(out > 0) || !Number.isFinite(out)) return 0;
  token.vToken = newVT;
  token.vSupra = newVS;
  token.raised += net;
  token.price = token.vSupra / token.vToken;
  return out;
}

function curveSell(token: StudioToken, tokens: number): number {
  if (!(tokens > 1)) return 0;
  const k = token.vToken * token.vSupra;
  const newVT = token.vToken + tokens;
  const newVS = k / newVT;
  const gross = token.vSupra - newVS;
  if (!(gross > 0) || !Number.isFinite(gross)) return 0;
  token.vToken = newVT;
  token.vSupra = newVS;
  token.raised = Math.max(0, token.raised - gross);
  token.price = token.vSupra / token.vToken;
  return gross * (1 - FEE);
}

function quoteCurveSell(token: StudioToken, tokens: number): number {
  const copy: StudioToken = { ...token, spark: token.spark };
  return curveSell(copy, tokens);
}

function listedFillBuy(price: number, supra: number): { tokens: number; avg: number } {
  const net = supra * (1 - 0.003);
  const impact = Math.min(0.12, supra / 2_000_000);
  const avg = price * (1 + impact);
  return { tokens: net / avg, avg };
}

function listedFillSell(price: number, tokens: number): number {
  const gross = tokens * price;
  const impact = Math.min(0.12, gross / 2_000_000);
  return gross * (1 - 0.003) * (1 - impact * 0.5);
}

function sampleEquity(book: Book, force: boolean): void {
  if (!force && book.strategyMs - book.lastEquityAt < 20_000) return;
  book.lastEquityAt = book.strategyMs;
  book.equity.push({ s: book.strategyMs, v: equityNow(book) });
  if (book.equity.length > 90) book.equity.shift();
}

function ageMin(book: Book, token: { born: number }): number {
  return (book.strategyMs - token.born) / 60000;
}

function pushLog(book: Book, entry: Omit<Activity, "id">): void {
  book.log.unshift({ ...entry, id: book.nextId++ });
  if (book.log.length > 160) book.log.length = 160;
}

function pickName(book: Book, name?: string, symbol?: string): { name: string; symbol: string } {
  if (name && symbol) return { name, symbol };
  const used = new Set(book.tokens.map((token) => token.symbol));
  for (let i = 0; i < NAMES.length; i++) {
    const idx = Math.floor(nextRand(book) * NAMES.length);
    const row = NAMES[idx]!;
    if (!used.has(row[1])) return { name: row[0], symbol: row[1] };
  }
  const n = book.nextId;
  return { name: `Coin ${n}`, symbol: `C${n}` };
}

function creatorAddr(n: number): string {
  const hex = (n * 0x9e3779b1).toString(16).padStart(8, "0").slice(0, 8);
  return `0x${hex}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-3)}`;
}

function nextRand(book: Book): number {
  let a = book.rngState | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  book.rngState = a;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function fmtInt(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = Math.round(Math.abs(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtSigned(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + fmtInt(Math.abs(n));
}
