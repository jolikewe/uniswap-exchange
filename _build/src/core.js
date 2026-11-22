// Port of the amm/ Python package (pool, arbitrage, cycles, lp, v3, legacy). Pure functions, no DOM.
const DEFAULT_FEE = 0.003, DAYS_PER_YEAR = 365;

/* ---------- pool (amm/pool.py) ---------- */
function ammOut(xIn, rIn, rOut, fee = DEFAULT_FEE) { const g = 1 - fee; return xIn * g * rOut / (rIn + xIn * g); }
function ammIn(xOut, rIn, rOut, fee = DEFAULT_FEE) { const g = 1 - fee; return rIn * xOut / (g * (rOut - xOut)); }
function mkPool(token0, token1, reserve0, reserve1, fee = DEFAULT_FEE) { return { token0, token1, reserve0, reserve1, fee }; }
const copyPool = p => ({ ...p });
const poolK = p => p.reserve0 * p.reserve1;
const poolPrice = p => p.reserve1 / p.reserve0;           // token1 per token0
const poolOther = (p, t) => { if (t === p.token0) return p.token1; if (t === p.token1) return p.token0; throw new Error('token not in pool'); };
function poolReserves(p, tIn) { poolOther(p, tIn); return tIn === p.token0 ? [p.reserve0, p.reserve1] : [p.reserve1, p.reserve0]; }
function poolRate(p, tIn) { const [a, b] = poolReserves(p, tIn); return (1 - p.fee) * b / a; }
function poolQuoteOut(p, tIn, x) { const [a, b] = poolReserves(p, tIn); return ammOut(x, a, b, p.fee); }
function poolSwap(p, tIn, x) {
  const out = poolQuoteOut(p, tIn, x);
  if (tIn === p.token0) { p.reserve0 += x; p.reserve1 -= out; } else { p.reserve1 += x; p.reserve0 -= out; }
  return out;
}

/* ---------- closed-form arbitrage (amm/arbitrage.py) ---------- */
function mobiusCoeffs(hops) {            // hops: [rIn, rOut, gamma]
  let A = 1, B = 1, C = 0;
  for (const [rIn, rOut, g] of hops) { const alpha = g * rOut, beta = rIn, delta = g; [A, B, C] = [alpha * A, beta * B, beta * C + delta * A]; }
  return [A, B, C];
}
const pathOutput = (a, A, B, C) => A * a / (B + C * a);
function optimalInput(A, B, C, flashFee = 0) {   // maximises A a/(B+C a) - (1+flashFee) a
  const lam = 1 + flashFee;
  if (A <= lam * B) return [0, 0];
  return [(Math.sqrt(A * B / lam) - B) / C, (Math.sqrt(A) - Math.sqrt(lam * B)) ** 2 / C];
}
function routeHops(first, second, start) {
  const mid = poolOther(first, start), r1 = poolReserves(first, start), r2 = poolReserves(second, mid);
  return [[r1[0], r1[1], 1 - first.fee], [r2[0], r2[1], 1 - second.fee]];
}
function simulateRoute(first, second, start, a) {
  const mid = poolOther(first, start);
  return poolQuoteOut(second, mid, poolQuoteOut(first, start, a)) - a;
}
// gas: {token: cost of the transaction in that token}; profit is NET of flash fee and gas
function twoPoolArbitrage(p1, p2, gas = {}, flashFee = 0) {
  let best = null, bestProfit = 0;
  [[p1, p2], [p2, p1]].forEach(([first, second], i) => {
    for (const start of [first.token0, first.token1]) {
      const [a, net0] = optimalInput(...mobiusCoeffs(routeHops(first, second, start)), flashFee);
      const g = gas[start] || 0, net = net0 - g;
      if (a > 0 && net > bestProfit) {
        const mid = poolQuoteOut(first, start, a), out = poolQuoteOut(second, poolOther(first, start), mid);
        best = { startToken: start, buyPool: i, amountIn: a, amountMid: mid, amountOut: out, profit: net, priceGap: Math.abs(poolPrice(p1) / poolPrice(p2) - 1), grossProfit: out - a, flashCost: flashFee * a, gasCost: g };
        bestProfit = net;
      }
    }
  });
  return best;
}
function breakevenMispricing(pool, gas = {}, flashFee = 0, fee2 = null, hi = 0.5) {
  const twin = g => mkPool(pool.token0, pool.token1, pool.reserve0, pool.reserve1 * (1 + g), fee2 === null ? pool.fee : fee2);
  const paid = g => twoPoolArbitrage(pool, twin(g), gas, flashFee) !== null;
  if (!paid(hi)) return NaN;
  let lo = 0, up = hi;
  for (let i = 0; i < 100; i++) { const mid = (lo + up) / 2; if (paid(mid)) up = mid; else lo = mid; }
  return up;
}
function profitCurve(first, second, start, amounts) {
  const [A, B, C] = mobiusCoeffs(routeHops(first, second, start));
  return amounts.map(a => pathOutput(a, A, B, C) - a);
}
function bruteForceOptimum(first, second, start, grid = 4001) {   // swap-based grid + golden section
  const scale = poolReserves(first, start)[0], lo0 = Math.log(1e-9 * scale), hi0 = Math.log(1e4 * scale);
  const xs = [0]; for (let i = 0; i < grid; i++) xs.push(Math.exp(lo0 + (hi0 - lo0) * i / (grid - 1)));
  const f = a => simulateRoute(first, second, start, a);
  let bi = 0, bv = -Infinity; xs.forEach((x, i) => { const v = f(x); if (v > bv) { bv = v; bi = i; } });
  let lo = xs[Math.max(bi - 1, 0)], hi = xs[Math.min(bi + 1, xs.length - 1)];
  const phi = (Math.sqrt(5) - 1) / 2; let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
  for (let i = 0; i < 200; i++) { if (f(c) > f(d)) { hi = d; d = c; c = hi - phi * (hi - lo); } else { lo = c; c = d; d = lo + phi * (hi - lo); } }
  const a = (lo + hi) / 2; return [a, f(a)];
}

/* ---------- cycles (amm/cycles.py): edge = [poolIndex, tokenIn, tokenOut] ---------- */
function buildEdges(pools) { const e = []; pools.forEach((p, i) => { e.push([i, p.token0, p.token1]); e.push([i, p.token1, p.token0]); }); return e; }
const edgeWeight = (pools, e) => -Math.log(poolRate(pools[e[0]], e[1]));
function findNegativeCycle(pools, tol = 1e-12) {
  const edges = buildEdges(pools), tokens = [...new Set(pools.flatMap(p => [p.token0, p.token1]))].sort();
  const dist = {}, pred = {}; tokens.forEach(t => { dist[t] = 0; pred[t] = null; });
  let last = null, passes = 0;
  for (let it = 0; it < tokens.length; it++) {
    last = null; passes++;
    for (const e of edges) {
      const w = edgeWeight(pools, e);
      if (dist[e[1]] + w < dist[e[2]] - tol) { dist[e[2]] = dist[e[1]] + w; pred[e[2]] = e; last = e[2]; }
    }
    if (last === null) { findNegativeCycle.passes = passes; return null; }
  }
  findNegativeCycle.passes = passes;
  let node = last;
  for (let i = 0; i < tokens.length; i++) node = pred[node][1];
  const cycle = []; let cur = node;
  for (;;) { const e = pred[cur]; cycle.push(e); cur = e[1]; if (cur === node) break; }
  return cycle.reverse();
}
const cycleRate = (pools, cycle) => cycle.reduce((m, [i, t]) => m * poolRate(pools[i], t), 1);
function rotateCycle(cycle, start) { const k = cycle.findIndex(e => e[1] === start); return cycle.slice(k).concat(cycle.slice(0, k)); }
function sizeCycle(pools, cycle, startToken = null, gas = {}, flashFee = 0) {
  if (startToken !== null) cycle = rotateCycle(cycle, startToken);
  const hops = cycle.map(([i, t]) => { const [a, b] = poolReserves(pools[i], t); return [a, b, 1 - pools[i].fee]; });
  const [A, B, C] = mobiusCoeffs(hops), [a, net] = optimalInput(A, B, C, flashFee);
  const g = a > 0 ? (gas[cycle[0][1]] || 0) : 0, gross = a > 0 ? A * a / (B + C * a) - a : 0;
  return { cycle, startToken: cycle[0][1], amountIn: a, amountOut: a + gross, profit: a > 0 ? net - g : 0, rate: cycleRate(pools, cycle), grossProfit: gross, flashCost: flashFee * a, gasCost: g };
}
function executeCycle(pools, trade) { let amt = trade.amountIn; const legs = []; for (const [i, t, u] of trade.cycle) { const out = poolSwap(pools[i], t, amt); legs.push({ pool: i, tIn: t, tOut: u, amtIn: amt, amtOut: out }); amt = out; } trade.legs = legs; return amt; }
function arbitrageUntilFlat(pools, maxIter = 100, minProfit = 1e-12, gas = {}, flashFee = 0) {
  const work = pools.map(copyPool), trades = [];
  for (let n = 0; n < maxIter; n++) {
    const cyc = findNegativeCycle(work);
    if (cyc === null || new Set(cyc.map(e => e[0])).size < cyc.length) break;
    const tr = sizeCycle(work, cyc, null, gas, flashFee);
    if (tr.profit <= minProfit) break;
    executeCycle(work, tr); trades.push(tr);
  }
  return [trades, work];
}

/* ---------- LP analytics (amm/lp.py) ---------- */
const impermanentLoss = r => 2 * Math.sqrt(r) / (1 + r) - 1;
const expectedLvrFraction = (sigma, years) => 1 - Math.exp(-sigma * sigma * years / 8);
const breakEvenTurnover = (sigma, fee) => sigma * sigma / 8 / DAYS_PER_YEAR / fee;
function arbitrageToPrice(x, y, S, fee, gas = 0) {
  const g = 1 - fee, k = x * y, p = y / x;
  const buy = p < g * S, sell = p > S / g;
  const dy = buy ? (Math.sqrt(g * k * S) - y) / g : 0, dx = sell ? (Math.sqrt(g * k / S) - x) / g : 0;
  const xn = buy ? k / (y + g * dy) : sell ? x + dx : x, yn = buy ? y + dy : sell ? k / (x + g * dx) : y;
  let profit = (x - xn) * S + (y - yn);
  if (gas > 0) { if (profit <= gas) return [x, y, 0]; profit -= gas; }
  return [xn, yn, profit];
}
// seeded generator: mulberry32 + Box-Muller
function makeNormal(seed) {
  let s = seed >>> 0, spare = null;
  const u = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { if (spare !== null) { const v = spare; spare = null; return v; } let a = 0; while (a === 0) a = u(); const b = u(), r = Math.sqrt(-2 * Math.log(a)); spare = r * Math.sin(2 * Math.PI * b); return r * Math.cos(2 * Math.PI * b); };
}
// LP Monte Carlo. Z: optional [path][step] normals. recordAt: step indices whose `net` is kept for all paths.
function simulateLP({ sigma, fee = 0.003, turnover = 0, days = 30, stepsPerDay = 24, nPaths = 1000, seed = 0, mu = 0, S0 = 1, V0 = 1, Z = null, recordAt = [], gas = 0 }) {
  const n = Math.round(days * stepsPerDay), dtDays = 1 / stepsPerDay, dt = dtDays / DAYS_PER_YEAR;
  if (Z) nPaths = Z.length;
  const drift = (mu - 0.5 * sigma * sigma) * dt, vol = sigma * Math.sqrt(dt), rnd = Z ? null : makeNormal(seed);
  const out = { net: new Float64Array(nPaths), il: new Float64Array(nPaths), fees: new Float64Array(nPaths), lvr: new Float64Array(nPaths), S: new Float64Array(nPaths), arb: new Float64Array(nPaths), rec: recordAt.map(() => new Float64Array(nPaths)) };
  const recIdx = new Map(recAtMap(recordAt));
  function recAtMap(a) { return a.map((s, j) => [s, j]); }
  for (let p = 0; p < nPaths; p++) {
    let x = V0 / (2 * S0), y = V0 / 2, S = S0, w = V0, fees = 0, pool = V0, hodl = V0, arb = 0;
    if (recIdx.has(0)) out.rec[recIdx.get(0)][p] = 0;
    // running cumulative sum of the log-increments, as numpy cumsum does
    let logS = 0;
    for (let i = 1; i <= n; i++) {
      logS += drift + vol * (Z ? Z[p][i - 1] : rnd());
      const Sn = S0 * Math.exp(logS);
      w += x * (Sn - S);
      S = Sn;
      const [xn, yn, pr] = arbitrageToPrice(x, y, S, fee, gas); x = xn; y = yn; arb += pr;
      pool = x * S + y;
      fees += fee * turnover * dtDays * pool;
      if (recIdx.has(i)) { hodl = V0 / 2 * (S / S0 + 1); out.rec[recIdx.get(i)][p] = (pool + fees - hodl) / V0; }
    }
    hodl = V0 / 2 * (S / S0 + 1);
    out.net[p] = (pool + fees - hodl) / V0; out.il[p] = (pool - hodl) / V0; out.fees[p] = fees / V0; out.lvr[p] = (w - pool) / V0; out.S[p] = S; out.arb[p] = arb / V0;
  }
  return out;
}
function quantile(sorted, q) { const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h); return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo); }
function meanSe(a) { const n = a.length; let m = 0; for (const v of a) m += v; m /= n; let s = 0; for (const v of a) s += (v - m) ** 2; return [m, Math.sqrt(s / (n - 1) / n)]; }
function summarise(res) {
  const [mNet, seNet] = meanSe(res.net), [mLvr, seLvr] = meanSe(res.lvr);
  let win = 0; for (const v of res.net) if (v > 0) win++;
  return { meanNet: mNet, seNet, pWin: win / res.net.length, meanIl: meanSe(res.il)[0], meanFees: meanSe(res.fees)[0], meanLvr: mLvr, seLvr };
}

/* ---------- Uniswap v3 range maths (amm/v3.py) ---------- */
function v3Amounts(L, p, pa, pb) { const sa = Math.sqrt(pa), sb = Math.sqrt(pb), sp = Math.min(Math.max(Math.sqrt(p), sa), sb); return [L * (1 / sp - 1 / sb), L * (sp - sa)]; }
function v3LiquidityFromValue(v0, p0, pa, pb) { const [x1, y1] = v3Amounts(1, p0, pa, pb); return v0 / (x1 * p0 + y1); }
function v3IlVsHodl(p, p0, pa, pb) {
  const L = v3LiquidityFromValue(1, p0, pa, pb), [x0, y0] = v3Amounts(L, p0, pa, pb), [x, y] = v3Amounts(L, p, pa, pb);
  return (x * p + y) / (x0 * p + y0) - 1;
}
const v3ConcentrationFactor = (p0, pa, pb) => v3LiquidityFromValue(1, p0, pa, pb) / (1 / (2 * Math.sqrt(p0)));

/* ---------- original notebook model (amm/legacy.py) ---------- */
function mkNotebookPool(name, dai, eth) { const p = { name, dai, eth }; legacyRefresh(p); return p; }
function legacyRefresh(p) { p.k = p.dai * p.eth; p.price = p.eth / p.dai; }
const LEGACY_FEE = 1.003;
function legacyPriceInput(p, outDai) { return (p.k / (p.dai - outDai) - p.eth) * LEGACY_FEE; }
function legacyPriceOutput(p, inDai) { return p.eth - p.k / (inDai + p.dai); }
function legacySwapEth(p, inEth) { p.dai -= p.dai - p.k / (inEth + p.eth); p.eth += inEth * LEGACY_FEE; legacyRefresh(p); }
function legacyArbitrage(a, b, outDai) {
  if (a.price === b.price) return null;
  const [hi, lo] = a.price > b.price ? [a, b] : [b, a];
  const req = legacyPriceInput(lo, outDai), rec = legacyPriceOutput(hi, outDai), profit = rec - req;
  return profit > 0 ? [req, profit, lo.name] : null;
}
