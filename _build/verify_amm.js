// Checks that the JS port in src/core.js (inlined in ../index.html) matches the Python package.
// Usage: node verify_amm.js [path/to/uniswap_arbitrage.ipynb]   (run make_fixtures.py first)
const fs = require('fs'), path = require('path');
const core = fs.readFileSync(path.join(__dirname, 'src/core.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
if (!html.includes(core.trim())) { console.log('FAIL index.html does not contain src/core.js verbatim (run build_page.py)'); process.exit(1); }
const names = (core.match(/^(?:function|const) (\w+)/gm) || []).map(s => s.split(' ')[1]);
const A = new Function(core + ';return {' + names.join(',') + '}')();
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
let bad = 0, checks = 0, maxRel = 0;
function eq(label, got, exp, tol = 1e-9) {
  if (Array.isArray(exp)) { if (!Array.isArray(got) || got.length !== exp.length) { bad++; console.log('FAIL', label, 'shape'); return; } exp.forEach((e, i) => eq(label + '[' + i + ']', got[i], e, tol)); return; }
  if (typeof exp === 'string' || exp === null || typeof exp === 'boolean') { checks++; if (got !== exp) { bad++; console.log('FAIL', label, got, exp); } return; }
  checks++;
  const rel = Math.abs(got - exp) / Math.max(Math.abs(exp), Math.abs(got), 1e-12);
  const ok = Math.abs(got - exp) <= 1e-12 || rel <= tol;
  if (ok) maxRel = Math.max(maxRel, Math.abs(got - exp) === 0 ? 0 : rel); else { bad++; console.log('FAIL', label, got, exp, rel); }
}
const mk = a => A.mkPool(...a);
const keyMap = { start_token: 'startToken', buy_pool: 'buyPool', amount_in: 'amountIn', amount_mid: 'amountMid', amount_out: 'amountOut', price_gap: 'priceGap', gross_profit: 'grossProfit', flash_cost: 'flashCost', gas_cost: 'gasCost', profit: 'profit' };

F.swaps.forEach((c, i) => { const p = mk(c.pool); eq(`swap${i}.rate`, A.poolRate(p, c.tok), c.rate); const o = A.poolSwap(p, c.tok, c.x); eq(`swap${i}.out`, o, c.out); eq(`swap${i}.r0`, p.reserve0, c.r0); eq(`swap${i}.r1`, p.reserve1, c.r1); eq(`swap${i}.k`, A.poolK(p), c.k); });
F.arbs.forEach((c, i) => {
  const p1 = mk(c.p1), p2 = mk(c.p2), r = A.twoPoolArbitrage(p1, p2, c.gas, c.flash);
  if (c.res === null) { checks++; if (r !== null) { bad++; console.log('FAIL arb', i, 'expected none'); } return; }
  if (!r) { bad++; console.log('FAIL arb', i, 'expected trade'); return; }
  for (const [k, j] of Object.entries(keyMap)) eq(`arb${i}.${k}`, r[j], c.res[k]);
  const [first, second] = c.res.buy_pool === 0 ? [p1, p2] : [p2, p1];
  eq(`arb${i}.curve`, A.profitCurve(first, second, r.startToken, c.curve_x), c.curve_y);
});
F.breakeven.forEach((c, i) => eq(`breakeven${i}`, A.breakevenMispricing(A.mkPool('ETH', 'USDC', 10000, 20e6), { USDC: c.gas, ETH: c.gas / 2000 }, c.flash), c.gap));
// closed form vs brute force inside JS as well
{ const a = A.mkPool('DAI', 'ETH', 400, 1200), b = A.mkPool('DAI', 'ETH', 2000, 5800), r = A.twoPoolArbitrage(a, b), [, p] = A.bruteForceOptimum(b, a, 'ETH'); eq('closed form vs brute force (JS)', r.profit, p, 1e-9); }

const nbk = F.notebook, na = A.mkNotebookPool('A', 400, 1200), nb = A.mkNotebookPool('B', 2000, 5800), nr = A.legacyArbitrage(na, nb, 10);
eq('notebook.required', nr[0], nbk.required); eq('notebook.profit', nr[1], nbk.profit);
eq('notebook.required (6dp)', +nr[0].toFixed(6), 29.233166); eq('notebook.profit (6dp)', +nr[1].toFixed(6), 0.035127);
{ const a = A.mkNotebookPool('A', 400, 1200), b = A.mkNotebookPool('B', 2000, 5700), r = A.legacyArbitrage(a, b, 10); eq('bench.required', r[0], nbk.bench_required); A.legacySwapEth(b, r[0]); eq('bench.B', [b.dai, b.eth, b.k], nbk.bench_b); }
if (process.argv[2]) {
  const nbJson = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const text = nbJson.cells.filter(c => c.cell_type === 'code').flatMap(c => (c.outputs || []).map(o => (o.text || []).join(''))).join('\n');
  for (const s of ['Buy 29.233166 ETH from Pool B', 'Total profit: $0.035127']) { checks++; if (!text.includes(s)) { bad++; console.log('FAIL notebook output missing', s); } }
}

F.cycles.forEach((c, i) => {
  const ps = c.pools.map(mk), cyc = A.findNegativeCycle(ps);
  eq(`cycle${i}.edges`, cyc === null ? null : cyc.flat(), c.cycle === null ? null : c.cycle.flat());
  if (!cyc) return;
  const t = A.sizeCycle(ps, cyc, null, c.gas, c.flash);
  eq(`cycle${i}.in`, t.amountIn, c.trade.in); eq(`cycle${i}.profit`, t.profit, c.trade.profit); eq(`cycle${i}.gross`, t.grossProfit, c.trade.gross); eq(`cycle${i}.rate`, t.rate, c.trade.rate);
  const [trades, flat] = A.arbitrageUntilFlat(ps, 100, 1e-12, c.gas, c.flash);
  eq(`cycle${i}.nTrades`, trades.length, c.flat.n); eq(`cycle${i}.tradeProfits`, trades.map(x => x.profit), c.flat.profits); eq(`cycle${i}.flat`, flat.map(p => [p.reserve0, p.reserve1]), c.flat.reserves);
});
eq('IL', F.il.r.map(A.impermanentLoss), F.il.il); eq('E[LVR]', A.expectedLvrFraction(0.8, 1), F.il.lvr); eq('break-even turnover', A.breakEvenTurnover(0.8, 0.003), F.il.be);
F.arbstep.forEach((c, i) => eq(`arbstep${i}`, A.arbitrageToPrice(c.x, c.y, c.S, c.fee, c.gas), c.out));
eq('v3 il narrow', F.v3.p.map(p => A.v3IlVsHodl(p, 1, 0.8, 1.25)), F.v3.il_a); eq('v3 il wide', F.v3.p.map(p => A.v3IlVsHodl(p, 1, 1 / 1.5, 1.5)), F.v3.il_b);
eq('v3 concentration', [A.v3ConcentrationFactor(1, 0.8, 1.25), A.v3ConcentrationFactor(1, 1 / 1.1, 1.1)], F.v3.cf);

const camel = c => ({ sigma: c.sigma, fee: c.fee, turnover: c.turnover, days: c.days, stepsPerDay: c.steps_per_day, mu: c.mu || 0, gas: c.gas || 0 });
F.lp_det.cases.forEach((c, i) => {
  const r = A.simulateLP({ ...camel(c.cfg), Z: F.lp_det.Z, recordAt: [24] });
  for (const [k, j] of [['net', 'net'], ['il', 'il'], ['fees', 'fees'], ['lvr', 'lvr'], ['arb', 'arb'], ['S', 'S']]) eq(`lp${i}.${k}`, Array.from(r[j]), c[k]);
  eq(`lp${i}.net@24`, Array.from(r.rec[0]), c.rec[0]);
});
// seeded JS generator vs numpy generator: statistical agreement (4 combined standard errors)
F.lp_stats.forEach((c, i) => {
  const s = A.summarise(A.simulateLP({ ...camel(c.cfg), nPaths: 20000, seed: 7 }));
  const z = (a, b, sa, sb) => Math.abs(a - b) / Math.sqrt(sa * sa + sb * sb);
  const zs = { net: z(s.meanNet, c.mean_net, s.seNet, c.se_net), lvr: z(s.meanLvr, c.mean_lvr, s.seLvr, c.se_lvr) };
  const pse = Math.sqrt(c.p_win * (1 - c.p_win) / 20000) * Math.SQRT2, zp = pse === 0 ? 0 : Math.abs(s.pWin - c.p_win) / pse;
  checks += 3; for (const [k, v] of Object.entries({ ...zs, pWin: zp })) if (v > 4) { bad++; console.log('FAIL lp_stats', i, k, 'z =', v.toFixed(2)); }
  console.log(`MC ${i}: mean net JS ${(s.meanNet * 100).toFixed(3)}% vs numpy ${(c.mean_net * 100).toFixed(3)}% (z ${zs.net.toFixed(2)}); LVR z ${zs.lvr.toFixed(2)}; P(win) ${s.pWin.toFixed(3)} vs ${c.p_win.toFixed(3)} (z ${zp.toFixed(2)})`);
});
console.log(`${checks} comparisons, max relative error on deterministic functions: ${maxRel.toExponential(2)}`);
console.log(bad ? `${bad} FAILURES` : 'ALL MATCH');
process.exit(bad ? 1 : 0);
