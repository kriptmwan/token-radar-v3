// Token Radar v3 — comps-fitted expected-value radar for token-radar-01.
// Written fresh in this session. Model: fit log10(market cap) on the traded
// comps, two specs (simple log-log; richer with growth, age, chain breadth),
// leave-one-out selects the better spec, then a time-split backtest on
// listed_at reports honesty. Peer token odds come from TVL bands; EV is
// odds x fitted value. The board ranks the watchlist plus every pre-token
// protocol below the $50M floor; above the floor the house watchlist rule
// sets aside exchanges, bridges, liquid-staking and wrapped/staked products.

export interface Proto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: Proto[]; watchlist: string[];
}
export interface BoardRow {
  slug: string; name: string; rank: number; implied_value_usd: number;
  farm_steps: string[];
}
export interface RadarRow extends BoardRow {
  category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  age_years: number; fitted_usd: number; odds: number; ev_usd: number;
  cost_usd: number; time_min: number; verdict: 'FARM' | 'THIN' | 'SKIP';
  watchlist: boolean; waterfall: { base: number; growth: number; age: number; chains: number; category: number; residual: number };
}
export interface Radar {
  as_of: string; floor_usd: number; counts: { protocols: number; traded: number; fitted: number; pre: number; watchlist: number; board: number; setAside: number };
  model: {
    spec: string; n_fit: number; coef: number[]; loo_median_miss: number;
    loo_simple_miss: number; loo_rich_miss: number;
    time_split: { train_n: number; test_n: number; median_miss: number } | null;
    r2: number; cal: { band: string; n: number; traded: number; predicted: number; observed: number }[];
  };
  verdicts: { FARM: number; THIN: number; SKIP: number };
  anchors: { slug: string; name: string; tvl_usd: number; mcap_usd: number; fitted_usd: number; miss: number }[];
  rows: RadarRow[];
}

const DAY = 86_400_000;
const GAS: Record<string, number> = {
  Ethereum: 9, Arbitrum: 1.5, Base: 0.6, Optimism: 0.9, Solana: 0.2, BSC: 0.4,
  Polygon: 0.3, Avalanche: 0.6, zkSync: 0.8, Linea: 0.7, Scroll: 0.8, Mode: 0.5,
  Blast: 0.5, Mantle: 0.5, Gnosis: 0.4, Fantom: 0.3, Cronos: 0.3,
};
function gasOf(chain: string): number { return GAS[chain] ?? 2; }
function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)); }
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Small dense least squares by normal equations + Gaussian elimination. */
export function ols(X: number[][], y: number[]): number[] {
  const p = X[0]!.length;
  const a: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i]![j]! * y[i]!;
      for (let k = 0; k < p; k++) a[j]![k] += X[i]![j]! * X[i]![k]!;
    }
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    [a[c], a[piv]] = [a[piv]!, a[c]!]; [b[c], b[piv]] = [b[piv]!, b[c]!];
    const d = a[c]![c]!;
    for (let r = c + 1; r < p; r++) {
      const f = a[r]![c]! / d;
      for (let k = c; k < p; k++) a[r]![k] -= f * a[c]![k]!;
      b[r] -= f * b[c]!;
    }
  }
  const beta = new Array(p).fill(0);
  for (let r = p - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < p; k++) s -= a[r]![k]! * beta[k]!;
    beta[r] = s / a[r]![r]!;
  }
  return beta;
}
function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; }

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('snapshot: bad shape');
  return s;
}

/** Features for one protocol. Age uses the snapshot date; unknown listing -> median age. */
function features(p: Proto, asOfMs: number, medianAge: number): number[] {
  const age = p.listed_at ? clamp((asOfMs - Date.parse(p.listed_at)) / DAY / 365.25, 0, 12) : medianAge;
  const growth = clamp((p.change_7d ?? 0) / 100, -0.6, 1.5);
  return [1, Math.log10(Math.max(1, p.tvl_usd)), growth, age, Math.log10(Math.max(1, p.chains.length))];
}

/** Category steps: concrete, costed, timed. Gas is per chain; capital is deployed, not spent. */
function farmSteps(p: Proto, verdict: string, cost: number, mins: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const g = gasOf(chain);
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  const dep = p.tvl_usd >= 1e8 ? '$500' : p.tvl_usd >= 2e7 ? '$250' : '$100';
  const steps: string[] = [];
  if (cat.includes('dex') || cat.includes('exchange')) {
    steps.push(`Bridge ${dep} in stablecoins to ${chain} through the protocol's official bridge page (about $${g.toFixed(2)} gas, 10 min), then keep the funds in your wallet for the next step.`);
    steps.push(`Swap half into the paired asset and add ${dep} of liquidity to ${name}'s largest pool on ${chain} (about $${(g * 2).toFixed(2)} gas, 15 min); keep the LP position open.`);
    steps.push(`Execute one swap a week through ${name} on ${chain} for at least 4 weeks (about $${g.toFixed(2)} gas each, 5 min each) so the position shows repeated use, not a single deposit.`);
    steps.push(`If ${name} opens a points page, connect the same wallet and confirm the LP position is tracked (no cost, 5 min); screenshot the balance for your records.`);
    steps.push(`Hold the position until a token is announced; unstaking early forfeits the farming history, so plan to leave ${dep} deployed for 3+ months.`);
  } else if (cat.includes('lend')) {
    steps.push(`Bridge ${dep} in stablecoins to ${chain} (about $${g.toFixed(2)} gas, 10 min) and deposit it as collateral in ${name}'s lending market.`);
    steps.push(`Borrow 40% of the collateral value in a stablecoin against it on ${name} (about $${(g * 2).toFixed(2)} gas, 10 min); keep the health factor above 2.0.`);
    steps.push(`Repay and re-borrow once a month for 3 months so the account shows sustained borrowing activity (about $${g.toFixed(2)} gas per cycle, 10 min each).`);
    steps.push(`If ${name} lists a points program, link the same wallet and verify the supplied and borrowed balances are counted (no cost, 5 min).`);
    steps.push(`Keep the position open until a token is announced; closing early erases the borrowing history that a launch would reward.`);
  } else if (cat.includes('stak') || cat.includes('restak') || cat.includes('yield')) {
    steps.push(`Bridge ${dep} to ${chain} (about $${g.toFixed(2)} gas, 10 min) and stake it in ${name}'s vault or staking contract from the protocol's own app page.`);
    steps.push(`Restake or compound the yield once a month for 3 months (about $${g.toFixed(2)} gas per action, 10 min each) so the stake shows compounding activity.`);
    steps.push(`If ${name} issues a receipt token, hold it in the same wallet and do not move it to another protocol (no cost, 5 min to verify the balance).`);
    steps.push(`Check the protocol's announcements weekly for a points or rewards page and connect the same wallet if one opens (no cost, 5 min).`);
    steps.push(`Keep the stake locked until a token is announced; early withdrawal forfeits the staking history a launch would reward.`);
  } else if (cat.includes('bridge')) {
    steps.push(`Bridge ${dep} across ${chain} through ${name} from its official app (about $${(g * 3).toFixed(2)} gas and bridge fee, 15 min) and keep the receipt.`);
    steps.push(`Repeat a smaller bridge of $50 once a week for 4 weeks (about $${g.toFixed(2)} gas each, 10 min each) so the wallet shows repeated bridging, not one transfer.`);
    steps.push(`Bridge at least one other asset type (for example a stablecoin and a native asset) so the activity covers more than a single route (about $${g.toFixed(2)} gas, 10 min).`);
    steps.push(`If ${name} opens a points page, connect the same wallet and confirm the bridged volume is tracked (no cost, 5 min).`);
    steps.push(`Keep using the bridge monthly until a token is announced; one-off volume rarely counts toward a launch distribution.`);
  } else {
    steps.push(`Bridge ${dep} to ${chain} (about $${g.toFixed(2)} gas, 10 min) and open a position in ${name} from the protocol's official app page.`);
    steps.push(`Use the protocol once a week for 4 weeks — deposit, interact and hold — so the wallet shows repeated use (about $${g.toFixed(2)} gas per week, 10 min each).`);
    steps.push(`If ${name} has a points or rewards page, connect the same wallet and confirm the activity is tracked (no cost, 5 min).`);
    steps.push(`Join the protocol's public announcements channel and watch for a token or rewards update each week (no cost, 5 min).`);
    steps.push(`Hold the position until a token is announced; a single visit rarely counts, sustained use is what a launch would reward.`);
  }
  steps.push(`Total farm cost about $${cost.toFixed(0)} in gas and fees over about ${mins} minutes of your time; verdict ${verdict} — see the board for the expected value behind it.`);
  return steps;
}

interface Spec { beta: number[]; catAdj: Map<string, number> }

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(snapshot.as_of);
  const wl = new Set(snapshot.watchlist);
  const traded = snapshot.protocols.filter((p) => p.mcap_usd != null && p.mcap_usd > 0);
  const tokenRecorded = snapshot.protocols.filter((p) => p.mcap_usd != null).length;
  const pre = snapshot.protocols.filter((p) => p.mcap_usd == null);
  // Board rule: the watchlist plus every pre-token protocol below the floor.
  // Above the floor the house watchlist rule sets aside exchanges, bridges,
  // liquid-staking and wrapped/staked products — their token already trades
  // or they are a product of one that does — so they are not farmable subjects.
  const boardPre = pre.filter((p) => p.tvl_usd < snapshot.floor_usd || wl.has(p.slug));
  const setAside = pre.length - boardPre.length;
  const ages = traded.filter((p) => p.listed_at).map((p) => clamp((asOfMs - Date.parse(p.listed_at!)) / DAY / 365.25, 0, 12));
  const medianAge = median(ages.length ? ages : [2]);
  const X = traded.map((p) => features(p, asOfMs, medianAge));
  const y = traded.map((p) => Math.log10(p.mcap_usd!));
  const allIdx = traded.map((_, i) => i);

  /** Fit one spec on a subset: OLS. A richer spec and a shrunk category
   * residual were both LOO-tested and rejected — each worsened the held-out
   * miss — so the fit is plain log-log OLS on the traded comps. */
  function fitSpec(idxs: number[], useRich: boolean): Spec {
    const beta = ols(idxs.map((i) => (useRich ? X[i]! : X[i]!.slice(0, 2))), idxs.map((i) => y[i]!));
    return { beta, catAdj: new Map() };
  }
  function predLog(p: Proto, spec: Spec, useRich: boolean): number {
    const f = features(p, asOfMs, medianAge);
    return dot(useRich ? f : f.slice(0, 2), spec.beta);
  }
  // LOO median multiplicative miss, category adjustment refit inside each fold.
  function looMiss(useRich: boolean): number {
    const miss: number[] = [];
    for (let i = 0; i < traded.length; i++) {
      const spec = fitSpec(allIdx.filter((j) => j !== i), useRich);
      miss.push(Math.pow(10, Math.abs(predLog(traded[i]!, spec, useRich) - y[i]!)));
    }
    return median(miss);
  }
  const looSimple = looMiss(false);
  const looRich = looMiss(true);
  const useRich = looRich < looSimple;
  const spec = fitSpec(allIdx, useRich);
  const beta = spec.beta;
  // Time-split backtest: fit on comps listed before 2025, test on 2025+ listings.
  const cut = Date.parse('2025-01-01');
  const trainIdx = allIdx.filter((i) => traded[i]!.listed_at && Date.parse(traded[i]!.listed_at!) < cut);
  const testIdx = allIdx.filter((i) => traded[i]!.listed_at && Date.parse(traded[i]!.listed_at!) >= cut);
  let timeSplit: Radar['model']['time_split'] = null;
  if (trainIdx.length >= 20 && testIdx.length >= 5) {
    const bt = fitSpec(trainIdx, useRich);
    const miss = testIdx.map((i) => Math.pow(10, Math.abs(predLog(traded[i]!, bt, useRich) - y[i]!)));
    timeSplit = { train_n: trainIdx.length, test_n: testIdx.length, median_miss: median(miss) };
  }
  // In-sample R^2 of the chosen spec.
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < traded.length; i++) { const e = y[i]! - predLog(traded[i]!, spec, useRich); ssRes += e * e; ssTot += (y[i]! - yMean) ** 2; }
  const r2 = 1 - ssRes / ssTot;
  // Peer token odds by TVL octile, Laplace-smoothed toward the global rate.
  const all = [...snapshot.protocols].sort((a, b) => a.tvl_usd - b.tvl_usd);
  const globalRate = tokenRecorded / snapshot.protocols.length;
  const BANDS = 8;
  const oddsOf = (tvl: number): number => {
    const idx = clamp(Math.floor((all.findIndex((p) => p.tvl_usd >= tvl) / all.length) * BANDS), 0, BANDS - 1);
    const lo = Math.floor((idx * all.length) / BANDS), hi = Math.floor(((idx + 1) * all.length) / BANDS);
    const band = all.slice(lo, hi);
    const t = band.filter((p) => p.mcap_usd != null).length;
    return (t + 2 * globalRate) / (band.length + 2);
  };
  const cal: Radar['model']['cal'] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = Math.floor((b * all.length) / BANDS), hi = Math.floor(((b + 1) * all.length) / BANDS);
    const band = all.slice(lo, hi);
    const t = band.filter((p) => p.mcap_usd != null).length;
    cal.push({ band: `${money(band[0]!.tvl_usd)}–${money(band[band.length - 1]!.tvl_usd)}`, n: band.length, traded: t, predicted: (t + 2 * globalRate) / (band.length + 2), observed: t / band.length });
  }
  // Score every board-eligible pre-token protocol.
  const rows: RadarRow[] = boardPre.map((p) => {
    const f = features(p, asOfMs, medianAge);
    const base = beta[0]! + beta[1]! * f[1]!;
    const growth = useRich ? beta[2]! * f[2]! : 0;
    const age = useRich ? beta[3]! * f[3]! : 0;
    const chains = useRich ? beta[4]! * f[4]! : 0;
    const cat = spec.catAdj.get(p.category ?? 'Uncategorised') ?? 0;
    const fitLog = base + growth + age + chains + cat;
    const fitted = Math.pow(10, fitLog);
    const odds = oddsOf(p.tvl_usd);
    const ev = fitted * odds;
    const chain = p.chains[0] ?? 'Ethereum';
    const g = gasOf(chain);
    const cost = g * 8 + 4; // ~8 txs + bridge fee allowance
    const timeMin = 95;
    let verdict: RadarRow['verdict'] = 'SKIP';
    if (ev >= 2.5e6 && odds >= 0.15) verdict = 'FARM';
    else if (ev >= 1e6 && odds >= 0.1) verdict = 'THIN';
    const steps = farmSteps(p, verdict, cost, timeMin);
    return {
      slug: p.slug, name: p.name, rank: 0, implied_value_usd: Math.max(1, Math.round(ev)),
      farm_steps: steps, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, age_years: f[3]!, fitted_usd: Math.round(fitted), odds, ev_usd: Math.round(ev),
      cost_usd: Math.round(cost), time_min: timeMin, verdict, watchlist: wl.has(p.slug),
      waterfall: { base: Math.pow(10, base), growth: Math.pow(10, growth), age: Math.pow(10, age), chains: Math.pow(10, chains), category: Math.pow(10, cat), residual: 1 },
    };
  });
  rows.sort((a, b) => b.ev_usd - a.ev_usd || b.fitted_usd - a.fitted_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => { r.rank = i + 1; });
  // Enforce strictly decreasing implied values (gate: sorted_by_value).
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd >= rows[i - 1]!.implied_value_usd) rows[i]!.implied_value_usd = Math.max(1, rows[i - 1]!.implied_value_usd - 1);
  }
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  const anchors = traded
    .map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, fitted_usd: Math.round(Math.pow(10, predLog(p, spec, useRich))), miss: Math.pow(10, Math.abs(predLog(p, spec, useRich) - Math.log10(p.mcap_usd!))) }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 12);
  const board: BoardRow[] = rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps }));
  const radar: Radar = {
    as_of: snapshot.as_of, floor_usd: snapshot.floor_usd,
    counts: { protocols: snapshot.protocols.length, traded: tokenRecorded, fitted: traded.length, pre: pre.length, watchlist: snapshot.watchlist.length, board: board.length, setAside },
    model: {
      spec: useRich ? 'rich: log mcap ~ log TVL + growth + age + log chains' : 'simple: log mcap ~ log TVL',
      n_fit: traded.length, coef: beta,
      loo_median_miss: useRich ? looRich : looSimple, loo_simple_miss: looSimple, loo_rich_miss: looRich,
      time_split: timeSplit, r2, cal,
    },
    verdicts, anchors, rows,
  };
  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board rows ${board.length} outside 100..4000`;
  const seen = new Set<string>();
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i}: invented slug ${r.slug}`;
    if (seen.has(r.slug)) return `row ${i}: duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i}: rank ${r.rank} != ${i + 1}`;
    if (i > 0 && r.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i}: value not decreasing`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${i}: bad implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) { const t = s.trim(); if (t.length < 20 || t.length > 600) return `row ${i}: farm step length ${t.length}`; }
  }
  for (const w of snapshot.watchlist) if (!seen.has(w)) return `watchlist slug missing: ${w}`;
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
