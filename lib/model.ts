// Token Radar model v2: peer-priced implied value, built only from the snapshot's own figures.
//
// The starter model priced every protocol at one flat multiple of TVL (0.25x). This model instead
// asks what the snapshot itself says a dollar of TVL is worth in each category: for every category
// it takes the live-token protocols (the ones whose token already trades), forms each one's
// market-cap / TVL ratio, and uses the category median, shrunk toward the global median when a
// category has few traded peers. A pre-token protocol is then priced as if its token traded like
// its category's peers, adjusted by three factors the snapshot also carries:
//
//   implied = TVL x peer_multiple(category) x growth_factor x maturity_factor x breadth_factor
//
//   growth_factor    1 + clamp(change_7d, -50, +100) / 100 x 0.6   (unreported change: neutral 1)
//   maturity_factor  0.55 + 0.45 x ln(1 + age_days) / ln(1 + 1460) (age capped at four years;
//                    an unreported listing date is modelled as 270 days and flagged in the row)
//   breadth_factor   1 + 0.03 x min(chains - 1, 6)                  (each extra chain, up to +18%)
//
// No protocol name is ever special-cased: the same function prices every row, the peer multiples
// are recomputed from whatever snapshot is handed in, and every factor of every row is written to
// board.json and shown in the dashboard's detail view, so a reader can recompute any row by hand.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so the page and the code cannot drift apart. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
  peer_shrink_k: number;
  peer_min: number;
  peer_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_base: 0.55,
  maturity_span: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
  breadth_per_chain: 0.03,
  breadth_max_extra: 6,
  peer_shrink_k: 4,
  peer_min: 0.05,
  peer_max: 3,
};

export const MODEL_VERSION = 'radar-2-peer';

/** How many pre-token protocols below the watchlist floor the early radar adds, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's peer evidence: how many traded peers, and the multiple they imply. */
export interface CategoryPeer {
  category: string;
  peers: number;
  median_multiple: number;
  used_multiple: number;
}

/** One row of board.json: the ranked board's row, with the whole model breakdown attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    age_modelled: boolean;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row (the board row itself, farm plan included). */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders: the board, the live set, the peer table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  categories: CategoryPeer[];
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer multiples: one per category, from the snapshot's traded protocols. A category's raw
 * median is shrunk toward the global median by its peer count (weight n / (n + K)), then bounded,
 * so a category with two traded names cannot price a pre-token protocol at an outlier's ratio.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryPeer> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? clamp(median(all), model.peer_min, model.peer_max) : model.peer_min;
  const byCategory = new Map<string, CategoryPeer>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const shrunk = (ratios.length * med + model.peer_shrink_k * global) / (ratios.length + model.peer_shrink_k);
    byCategory.set(category, {
      category,
      peers: ratios.length,
      median_multiple: round4(med),
      used_multiple: round4(clamp(shrunk, model.peer_min, model.peer_max)),
    });
  }
  return { global: round4(global), byCategory };
}

/** The multiple a protocol is priced at: its category's peer multiple, else the global one. */
function peerFor(p: SnapshotProtocol, peers: { global: number; byCategory: Map<string, CategoryPeer> }): { multiple: number; count: number } {
  const entry = peers.byCategory.get(p.category ?? 'Uncategorised');
  if (entry === undefined) return { multiple: peers.global, count: 0 };
  return { multiple: entry.used_multiple, count: entry.peers };
}

/** Every factor of one protocol's implied value, and the value itself. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: { global: number; byCategory: Map<string, CategoryPeer> },
  model: ModelConstants = MODEL,
): { implied: number; peerMultiple: number; peerCount: number; growthPct: number | null; growthMult: number; maturityMult: number; breadthMult: number; age: number | null; ageModelled: boolean } {
  const age = ageDays(asOf, protocol.listed_at);
  const ageModelled = age === null;
  const ageForModel = age ?? model.unknown_age_days;
  const growthPct = protocol.change_7d === null ? null : clamp(protocol.change_7d, model.growth_floor, model.growth_cap);
  const growthMult = 1 + ((growthPct ?? 0) / 100) * model.growth_weight;
  const maturityMult =
    model.maturity_base + model.maturity_span * (Math.log1p(Math.min(ageForModel, model.maturity_days)) / Math.log1p(model.maturity_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const { multiple, count } = peerFor(protocol, peers);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, peerMultiple: multiple, peerCount: count, growthPct, growthMult, maturityMult, breadthMult, age, ageModelled };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its figures say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: the largest rankable pre-token protocols below the floor — the launches a
  // reader can still get in front of, which is the whole point of a radar.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const peers = peerMultiples(snapshot, model);
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      peer_multiple: s.v.peerMultiple,
      peer_count: s.v.peerCount,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
      age_modelled: s.v.ageModelled,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The category's opening position, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow no more than 30% against it so the health factor stays wide`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} split evenly across both sides of ${n}'s highest-volume pool on ${chain}`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and keep the vault shares in the same wallet`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, then make one swap with the bridged funds on the far side`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${n} on ${chain} and keep the liquid receipt token unspent`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${n} and trade one small hedged position (long spot, short perp, same size)`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one position in ${n}'s most liquid market, holding it to settlement`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into the largest ${n} vault on ${chain} and leave the shares untouched while it allocates`;
  if (c.includes('stable')) return `Mint $${capital} of ${n}'s stable asset on ${chain} against USDC collateral and hold the minted asset`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s tokenised yield asset on ${chain} and hold it past one full yield cycle`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for the longest term it offers and keep the policy NFT`;
  if (c.includes('launchpad') || c.includes('token')) return `Stake $${capital} in ${n}'s launch pool on ${chain} so the wallet qualifies for the next allocation round`;
  if (c.includes('gaming') || c.includes('nft')) return `Spend up to $${capital} inside ${n} on ${chain}: one in-game or mint purchase, then keep playing from the same wallet`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open`;
}

/** The category's second, engagement step: the activity a points program actually counts. */
function engageFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay and re-borrow a small slice once a week on ${n} so the wallet shows both sides of the market, not one parked deposit`;
  if (c.includes('dex')) return `Swap about $25 through ${n} once a week, alternating pairs, so the wallet reads as a regular trader and not a one-off depositor`;
  if (c.includes('bridge')) return `Bridge a small amount back through ${n} once a month; a wallet that only ever bridges in looks like a dead end`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or re-delegate a small part of the position once a month on ${n} and vote with the receipt token when a vote opens`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Trade one small position a week on ${n}, win or lose, and keep total volume honest: consistency counts more than size`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Move about a fifth of the position between two ${n} vaults once a month, so the wallet follows the curator's own reallocations`;
  return `Use one more feature of ${n} on ${chain} each week (a second pool, a borrow, a vote or a swap) so the wallet is a user, not a deposit`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL tier, age) — never from a hand-written name list.
 * The same strings go to board.json and to the dashboard's detail view, so the two cannot disagree.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : capital >= 100 ? 6 : 4;
  const steps: Array<{ text: string; cost: string; time: string }> = [
    {
      text: `Set up a fresh wallet for ${p.name} alone, fund it from an exchange (never from a wallet you farm elsewhere), and keep its seed phrase offline`,
      cost: 'under $3 of gas to fund and make the first transaction',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: engageFor(p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days and keep the balance above half its starting size, so the wallet appears in more than one weekly snapshot`,
      cost: `the $${capital} stays in the position for the whole window`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points, rewards or governance page every Sunday and screenshot the wallet's standing; claim only from a link that page itself publishes`,
      cost: 'nothing to check; never pay a fee to claim',
      time: '5 minutes a week',
    },
    {
      text: `Spread the same plan over a second chain ${p.chains.length > 1 ? `(${p.chains[1]} is already in ${p.name}'s record)` : 'only if the protocol launches there'}: multi-chain wallets are the ones most points programs weight highest`,
      cost: `about $${gas} of bridge and gas fees`,
      time: '20 minutes, once',
    },
    {
      text: `Log every transaction hash, date and balance in a farm log, and set a calendar reminder for day ${hold} to review, top up or unwind the position`,
      cost: 'nothing but the log itself',
      time: '5 minutes a week',
    },
  ];
  return steps.map((s) => {
    let out = `${s.text}. Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    return out;
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot, model);
  const categories = [...peers.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: peers.global,
    categories,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
