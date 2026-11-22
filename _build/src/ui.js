(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const COL = { ink: '#0E1A2E', mute: '#5A6579', line: '#D8DEEA', eth: '#4A3FE0', usd: '#E9962A', mint: '#0B9A77', coral: '#E4484E', sky: '#8FB4FF', grid: '#E6EAF2' };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v, d = 2) => (v < 0 ? '-$' : '$') + fmt(Math.abs(v), d);
const sig = (v, d = 4) => { const a = Math.abs(v); return fmt(v, a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : d); };
const pct = (v, d = 2) => (v >= 0 ? '' : '-') + fmt(Math.abs(v) * 100, d) + '%';
const spct = (v, d = 2) => (v >= 0 ? '+' : '-') + fmt(Math.abs(v) * 100, d) + '%';
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const lin = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
function niceTicks(lo, hi, n) {
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
function setRange(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
function onWidth(el, fn) {
  let last = 0, raf = 0;
  const go = () => { raf = 0; const w = Math.round(el.getBoundingClientRect().width); if (w > 0 && w !== last) { last = w; fn(w); } };
  new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(go); }).observe(el); go();
  return () => { last = 0; go(); };
}
function later(fn) { let t = 0; return () => { if (!t) t = requestAnimationFrame(() => { t = 0; fn(); }); }; }

/* ---------------- assumptions ---------------- */
const A = { ethUsd: 2000, units: 150000, gwei: 20, flash: 0 };
const gasUsd = () => A.units * A.gwei * 1e-9 * A.ethUsd;
const listeners = [];
function readAssumptions() {
  A.ethUsd = Math.max(1e-6, +$('#aEth').value || 0); A.units = Math.max(0, +$('#aUnits').value || 0); A.gwei = Math.max(0, +$('#aGwei').value || 0); A.flash = Math.max(0, +$('#aFlash').value || 0) / 100;
  $('#aGasUsd').textContent = usd(gasUsd());
}
['#aEth', '#aUnits', '#aGwei', '#aFlash'].forEach(s => $(s).addEventListener('input', () => { readAssumptions(); listeners.forEach(f => f()); }));
const STABLE = new Set(['USD', 'USDC', 'DAI', 'USDT']);
const tokenUsdSimple = t => STABLE.has(t) ? 1 : t === 'ETH' ? A.ethUsd : 1;

/* ---------------- profit chart (hero + calculator) ---------------- */
function profitChart(svg, w, h, o) {
  const m = o.dark ? { l: 8, r: 8, t: 14, b: 22 } : { l: 58, r: 16, t: 16, b: 46 };
  const xmax = o.xmax, ys = o.ys, ymax = Math.max(...ys, o.optY || 0, 1e-12), ymin = Math.min(0, ...ys);
  const yr = (ymax - ymin) * 0.12 || 1, y0 = ymin - (ymin < 0 ? yr : 0), y1 = ymax + yr;
  const X = lin(0, xmax, m.l, w - m.r), Y = lin(y0, y1, h - m.b, m.t);
  const ink = o.dark ? '#DDE4F5' : COL.ink, grid = o.dark ? 'rgba(255,255,255,.1)' : COL.grid, line = o.dark ? '#8FB4FF' : COL.eth;
  let s = '';
  if (!o.dark) {
    for (const t of niceTicks(y0, y1, 5)) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${grid}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="12" fill="${COL.mute}">${o.yfmt(t)}</text>`;
    for (const t of niceTicks(0, xmax, w < 520 ? 3 : 6)) s += `<text x="${X(t)}" y="${h - 26}" text-anchor="middle" font-size="12" fill="${COL.mute}">${o.xfmt(t)}</text>`;
    s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 6}" text-anchor="middle" font-size="12" fill="${COL.mute}">${o.xlabel}</text>`;
  }
  s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="${o.dark ? 'rgba(255,255,255,.35)' : COL.ink}" stroke-width="1"/>`;
  const pts = o.xs.map((x, i) => [X(x), Y(ys[i])]), d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  s += `<path d="${d}L${pts[pts.length - 1][0]} ${Y(0)}L${pts[0][0]} ${Y(0)}Z" fill="${line}" opacity="${o.dark ? .16 : .1}"/><path d="${d}" fill="none" stroke="${line}" stroke-width="${o.dark ? 2.5 : 2.6}" stroke-linejoin="round"/>`;
  if (o.optX > 0) {
    const ox = X(o.optX), oy = Y(o.optY);
    s += `<line x1="${ox}" x2="${ox}" y1="${oy}" y2="${Y(0)}" stroke="${COL.mint}" stroke-dasharray="3 4"/><circle cx="${ox}" cy="${oy}" r="7" fill="${o.dark ? '#5EE6BF' : COL.mint}" stroke="${o.dark ? '#122241' : '#fff'}" stroke-width="3"/>`;
    if (!o.dark) { const right = ox < w * .6; s += `<text x="${ox + (right ? 12 : -12)}" y="${oy - 10}" text-anchor="${right ? 'start' : 'end'}" font-size="13" font-weight="700" fill="${COL.mint}">best size ${o.optLabel}</text>`; }
  }
  if (o.markX != null) { const mx = X(o.markX), my = Y(o.markY); s += `<line x1="${mx}" x2="${mx}" y1="${Y(0)}" y2="${my}" stroke="${COL.usd}" stroke-width="2"/><circle cx="${mx}" cy="${my}" r="6" fill="${COL.usd}" stroke="#fff" stroke-width="2.5"/>`; }
  if (o.sweepX != null) { const sx = X(o.sweepX), sy = Y(o.sweepY); s += `<circle cx="${sx}" cy="${sy}" r="7" fill="#fff" stroke="#5EE6BF" stroke-width="3"/>`; }
  if (o.dark) s += `<text x="${m.l}" y="${h - 4}" font-size="12" fill="#8FA0C4">small trade</text><text x="${w - m.r}" y="${h - 4}" text-anchor="end" font-size="12" fill="#8FA0C4">large trade: price moves against you</text>`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('height', h); svg.innerHTML = s;
}

/* ---------------- shared arbitrage scenario ---------------- */
function gasMapFor(t0, t1, toy) { if (toy) return {}; const g = gasUsd(); return { [t0]: g / tokenUsdSimple(t0), [t1]: g / tokenUsdSimple(t1) }; }
function bestRoute(pA, pB) {
  let best = null;
  [[pA, pB], [pB, pA]].forEach(([first, second], i) => { for (const start of [first.token0, first.token1]) { const [a, b, c] = mobiusCoeffs(routeHops(first, second, start)); const q = a / b; if (!best || q > best.q) best = { first, second, start, q, buyPool: i, A: a, B: b, C: c }; } });
  return best;
}
function curveFor(pA, pB, r, gas, flash, n = 120) {
  const rt = r ? { first: r.buyPool === 0 ? pA : pB, second: r.buyPool === 0 ? pB : pA, start: r.startToken } : bestRoute(pA, pB);
  const [A_, B_, C_] = mobiusCoeffs(routeHops(rt.first, rt.second, rt.start)), g = gas[rt.start] || 0;
  const reserve = poolReserves(rt.first, rt.start)[0], xmax = r ? Math.max(r.amountIn * 3, reserve * 1e-4) : reserve * 0.05;
  const xs = [], ys = []; for (let i = 0; i <= n; i++) { const x = xmax * i / n; xs.push(x); ys.push(i === 0 ? -g : pathOutput(x, A_, B_, C_) - x - flash * x - g); }
  return { xs, ys, xmax, rt, A_, B_, C_, g };
}

/* ---------------- hero ---------------- */
const hero = { done: false, t0: 0 };
function renderHero(progress = null) {
  const pA = mkPool('ETH', 'USDC', 10000, 20e6), pB = mkPool('ETH', 'USDC', 10000, 20.2e6), gas = gasMapFor('ETH', 'USDC'), r = twoPoolArbitrage(pA, pB, gas, A.flash);
  const f = x => x; const svg = $('#heroSvg'), w = Math.round(svg.getBoundingClientRect().width) || 480;
  const c = curveFor(pA, pB, r, gas, A.flash), uf = c.rt.start === 'USDC' ? 1 : A.ethUsd;
  const ys = c.ys.map(v => v * uf);
  const p = progress === null ? 1 : progress, sx = r ? r.amountIn * p : 0;
  const sy = r ? (pathOutput(sx, c.A_, c.B_, c.C_) - sx - A.flash * sx - c.g) * uf : 0;
  profitChart(svg, w, 190, { dark: true, xs: c.xs, ys, xmax: c.xmax, optX: p >= 1 && r ? r.amountIn : 0, optY: r ? r.profit * uf : 0, sweepX: p < 1 && r ? sx : null, sweepY: sy });
  const net = r ? sy : 0;
  $('#heroNet').textContent = r ? usd(Math.max(net, 0)) : '$0.00';
  $('#heroSize').textContent = r ? fmt(sx * (c.rt.start === 'USDC' ? 1 : A.ethUsd), 0) : '0';
  $('#heroGas').textContent = usd(gasUsd());
  $('#heroFees').textContent = r ? usd((r.amountIn * pA.fee * (r.startToken === 'USDC' ? 1 : A.ethUsd) + r.amountMid * pB.fee * (r.startToken === 'USDC' ? A.ethUsd : 1)) * p) : '$0';
  if (!r) $('#heroNet').textContent = 'No trade';
}
function heroAnimate() {
  if (REDUCED) { renderHero(); return; }
  hero.running = true;
  const t0 = performance.now(), dur = 1700;
  const tick = now => { const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3); renderHero(e >= 1 ? 1 : e); if (t < 1) requestAnimationFrame(tick); else hero.running = false; };
  requestAnimationFrame(tick);
}

/* ---------------- curve explorer ---------------- */
const cv = { x0: 1000, y0: 2e6, dir: 'eth', pct: 10, fee: 0.003 };
function curveState() {
  const g = 1 - cv.fee, k = cv.x0 * cv.y0;
  let dx = 0, dy = 0, xn = cv.x0, yn = cv.y0, pay, get, payTok, getTok;
  if (cv.dir === 'eth') { dx = cv.x0 * cv.pct / 100; const out = ammOut(dx, cv.x0, cv.y0, cv.fee); xn = cv.x0 + dx; yn = cv.y0 - out; pay = dx; get = out; payTok = 'ETH'; getTok = 'USDC'; }
  else { dy = cv.y0 * cv.pct / 100; const out = ammOut(dy, cv.y0, cv.x0, cv.fee); yn = cv.y0 + dy; xn = cv.x0 - out; pay = dy; get = out; payTok = 'USDC'; getTok = 'ETH'; }
  const spot = cv.y0 / cv.x0, exec = cv.dir === 'eth' ? get / pay : pay / get;   // USDC per ETH
  const ideal = cv.dir === 'eth' ? pay * spot : pay / spot;                          // output at the pre-trade spot price, no fee
  const feeAmt = pay * cv.fee * (cv.dir === 'eth' ? spot : 1), impact = 1 - get / ideal;
  return { k, xn, yn, pay, get, payTok, getTok, spot, exec, impact, feeAmt, kn: xn * yn, newSpot: yn / xn };
}
function renderCurve(w) {
  const svg = $('#curveSvg'); w = w || Math.round($('#curvePlot').getBoundingClientRect().width) || 600;
  const h = w < 520 ? 320 : 400, m = { l: 62, r: 18, t: 16, b: 42 }, st = curveState();
  const X = lin(0.35 * cv.x0, 2.2 * cv.x0, m.l, w - m.r), Y = lin(0.3 * cv.y0, 2.6 * cv.y0, h - m.b, m.t);
  const curvePath = k => { let d = ''; for (let i = 0; i <= 90; i++) { const x = (0.38 + (2.2 - 0.38) * i / 90) * cv.x0, y = k / x; if (y > 2.6 * cv.y0) continue; d += (d ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1); } return d; };
  let s = '';
  for (const t of niceTicks(0.35 * cv.x0, 2.2 * cv.x0, w < 520 ? 4 : 6)) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${h - m.b}" stroke="${COL.grid}"/><text x="${X(t)}" y="${h - 22}" text-anchor="middle" font-size="12" fill="${COL.mute}">${fmt(t, 0)}</text>`;
  for (const t of niceTicks(0.3 * cv.y0, 2.6 * cv.y0, 5)) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${COL.grid}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="12" fill="${COL.mute}">${(t / 1e6).toFixed(1)}M</text>`;
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle" font-size="12.5" fill="${COL.mute}">ETH in the pool</text><text transform="translate(14 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${COL.mute}">USDC in the pool</text>`;
  s += `<path d="${curvePath(st.kn)}" fill="none" stroke="${COL.usd}" stroke-width="2" stroke-dasharray="6 5"/><path d="${curvePath(st.k)}" fill="none" stroke="${COL.eth}" stroke-width="3.2"/>`;
  const px = X(cv.x0), py = Y(cv.y0), qx = X(st.xn), qy = Y(st.yn);
  const tanY = cv.y0 - (cv.y0 / cv.x0) * (st.xn - cv.x0), ty = Y(tanY);
  s += `<line x1="${px}" y1="${py}" x2="${qx}" y2="${ty}" stroke="${COL.ink}" stroke-width="1.4" stroke-dasharray="2 3"/>`;
  if (Math.abs(ty - qy) > 3) s += `<line x1="${qx}" y1="${ty}" x2="${qx}" y2="${qy}" stroke="${COL.coral}" stroke-width="3"/>`;
  s += `<circle cx="${px}" cy="${py}" r="6" fill="#fff" stroke="${COL.ink}" stroke-width="2.5"/><text x="${px + 10}" y="${py - 10}" font-size="12.5" fill="${COL.ink}" font-weight="600">price now $${fmt(st.spot, 0)}</text>`;
  s += `<circle id="drag" cx="${qx}" cy="${qy}" r="9" fill="${COL.eth}" stroke="#fff" stroke-width="3" tabindex="0" role="slider" aria-label="Trade point on the curve" style="cursor:grab"/>`;
  s += `<text x="${w - m.r - 4}" y="${m.t + 14}" text-anchor="end" font-size="12.5" fill="${COL.eth}" font-weight="600">pool curve x·y = k</text><text x="${w - m.r - 4}" y="${m.t + 30}" text-anchor="end" font-size="12.5" fill="${COL.coral}" font-weight="600">red: price impact</text>`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('height', h); svg.innerHTML = s;
  svg._geom = { X, Y, m, w, h };
  $('#szOut').textContent = cv.pct.toFixed(1) + '% of ' + (cv.dir === 'eth' ? 'ETH' : 'USDC') + ' reserve';
  $('#sz').value = cv.pct; setRange($('#sz'));
  const kv = [['You pay', `${sig(st.pay)} ${st.payTok}`], ['You receive', `${sig(st.get)} ${st.getTok}`], ['Execution price', `$${fmt(st.exec, 2)} per ETH`],
    ['Price impact', `<span class="bad">${pct(st.impact, 2)}</span>`], ['Fee paid', `${usd(st.feeAmt, 2)} (${pct(cv.fee, 2)})`], ['Pool price after', `$${fmt(st.newSpot, 2)}`], ['k grew by', `<span class="good">${spct(st.kn / st.k - 1, 4)}</span>`]];
  $('#curveKv').innerHTML = kv.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
}
function initCurve() {
  const svg = $('#curveSvg');
  const fromPointer = e => {
    const g = svg._geom, r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (g.w / r.width), xv = g.X.invert ? 0 : null;
    const x0px = g.X(0.35 * cv.x0), x1px = g.X(2.2 * cv.x0), ex = 0.35 * cv.x0 + (x - x0px) / (x1px - x0px) * (2.2 * cv.x0 - 0.35 * cv.x0);
    const gm = 1 - cv.fee, k = cv.x0 * cv.y0;
    if (ex >= cv.x0) { cv.dir = 'eth'; cv.pct = Math.min(40, (ex - cv.x0) / cv.x0 * 100); }
    else { cv.dir = 'usd'; const xx = Math.max(ex, 0.38 * cv.x0); cv.pct = Math.min(40, (k / xx - cv.y0) / gm / cv.y0 * 100); }
    syncDir(); renderCurve();
  };
  let down = false;
  svg.addEventListener('pointerdown', e => { down = true; svg.setPointerCapture(e.pointerId); fromPointer(e); });
  svg.addEventListener('pointermove', e => { if (down) fromPointer(e); });
  svg.addEventListener('pointerup', () => { down = false; });
  svg.addEventListener('keydown', e => { if (e.target.id !== 'drag') return; const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.5 : 0; if (d) { e.preventDefault(); cv.pct = Math.max(0, Math.min(40, cv.pct + d)); renderCurve(); $('#drag').focus(); } });
  $('#sz').addEventListener('input', e => { cv.pct = +e.target.value; renderCurve(); });
  $('#dirEth').onclick = () => { cv.dir = 'eth'; syncDir(); renderCurve(); };
  $('#dirUsd').onclick = () => { cv.dir = 'usd'; syncDir(); renderCurve(); };
  $$('#curve [data-fee]').forEach(b => b.onclick = () => { cv.fee = +b.dataset.fee; $$('#curve [data-fee]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderCurve(); });
  function syncDir() { $('#dirEth').setAttribute('aria-pressed', cv.dir === 'eth'); $('#dirUsd').setAttribute('aria-pressed', cv.dir === 'usd'); }
  onWidth($('#curvePlot'), w => renderCurve(w));
}

/* ---------------- arbitrage calculator ---------------- */
const calc = { t0: 'ETH', t1: 'USDC', toy: false, tryFrac: 0.5, ready: false };
const num = id => +$(id).value;
function poolsFromInputs() {
  return [mkPool(calc.t0, calc.t1, num('#a0'), num('#a1'), Math.max(0, num('#af')) / 100), mkPool(calc.t0, calc.t1, num('#b0'), num('#b1'), Math.max(0, num('#bf')) / 100)];
}
function setLabels() { for (const s of ['a', 'b']) { $('#lbT0' + s).textContent = calc.t0 + ' reserve'; $('#lbT1' + s).textContent = calc.t1 + ' reserve'; } }
function applyGap() { const g = num('#gap') / 100; $('#b1').value = +(num('#b0') * (num('#a1') / num('#a0')) * (1 + g)).toPrecision(10); }
function loadPreset(name) {
  const set = (a0, a1, b0, b1, af, bf) => { $('#a0').value = a0; $('#a1').value = a1; $('#b0').value = b0; $('#b1').value = b1; $('#af').value = af; $('#bf').value = bf; };
  calc.toy = false; calc.t0 = 'ETH'; calc.t1 = 'USDC';
  if (name === 'notebook') { calc.toy = true; calc.t0 = 'DAI'; calc.t1 = 'ETH'; set(400, 1200, 2000, 5800, 0.3, 0.3); }
  else { set(10000, 20000000, 10000, 20200000, 0.3, 0.3); if (name === 'breakeven') { const pA = poolsFromInputs()[0], gap = breakevenGap(pA, poolsFromInputs()[1], gasMapFor('ETH', 'USDC'), A.flash, 1); $('#b1').value = +(10000 * 2000 * (1 + gap * 1.002)).toPrecision(10); } }
  setLabels(); $$('#arb [data-preset]').forEach(b => b.setAttribute('aria-pressed', b.dataset.preset === name));
  syncGapFromReserves(); renderArb();
}
function syncGapFromReserves() { const [a, b] = poolsFromInputs(); const g = poolPrice(b) / poolPrice(a) - 1; $('#gap').value = Math.max(-5, Math.min(5, +(g * 100).toFixed(2))); setRange($('#gap')); }
// smallest |gap| (B price vs A price, given sign) for which the net profit is positive, bisection on the closed form
function breakevenGap(pA, pB, gas, flash, sign) {
  const at = h => twoPoolArbitrage(pA, mkPool(pB.token0, pB.token1, pB.reserve0, pB.reserve0 * poolPrice(pA) * (1 + sign * h), pB.fee), gas, flash) !== null;
  if (!at(0.9)) return NaN; let lo = 0, hi = 0.9; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (at(mid)) hi = mid; else lo = mid; } return hi;
}
function renderArb(w) {
  if (!calc.ready) return;
  const [pA, pB] = poolsFromInputs(); if (![pA.reserve0, pA.reserve1, pB.reserve0, pB.reserve1].every(v => v > 0)) return;
  const gas = gasMapFor(calc.t0, calc.t1, calc.toy), flash = calc.toy ? 0 : A.flash, r = twoPoolArbitrage(pA, pB, gas, flash);
  const gapNow = poolPrice(pB) / poolPrice(pA) - 1, be = breakevenGap(pA, pB, gas, flash, gapNow >= 0 ? 1 : -1), be0 = breakevenGap(pA, pB, {}, 0, gapNow >= 0 ? 1 : -1);
  const uf = t => calc.toy ? 1 : tokenUsdSimple(t), money = (v, t, d = 2) => calc.toy ? `${fmt(v, 6)} ${t}` : usd(v * uf(t), d), unit = calc.toy ? '' : '$';
  const c = curveFor(pA, pB, r, gas, flash), st = c.rt.start;
  // headline
  const head = $('#arbHead');
  if (r) { head.className = 'headline pos'; head.innerHTML = `${money(r.profit, r.startToken)} net per transaction<small>Send ${sig(r.amountIn)} ${r.startToken}. Gap ${pct(Math.abs(gapNow))}, break-even ${pct(be)}.</small>`; }
  else { head.className = 'headline neg'; head.innerHTML = `No profit after costs<small>Gap ${pct(Math.abs(gapNow))} is below the break-even ${isNaN(be) ? 'of any size tested' : pct(be)}. ${be0 < Math.abs(gapNow) ? 'Fees alone would leave a profit; gas and flash fee take it.' : 'The two swap fees alone absorb the gap.'}</small>`; }
  // meter
  const scale = Math.max(0.05, Math.abs(gapNow) * 1.25, (be || 0) * 1.25);
  $('#mBand').style.width = Math.min(100, (be || 0) / scale * 100) + '%'; $('#mGap').style.left = `calc(${Math.min(100, Math.abs(gapNow) / scale * 100)}% - 1.5px)`;
  $('#meterNote').textContent = `Hatched: gap too small to pay (up to ${isNaN(be) ? '?' : pct(be)}). Marker: current gap ${pct(Math.abs(gapNow))}.`;
  // ledger
  const t = r ? r.startToken : st, gross = r ? r.grossProfit : 0, fc = r ? r.flashCost : 0, gc = r ? r.gasCost : (gas[st] || 0);
  const swapFees = r ? (r.amountIn * (r.buyPool === 0 ? pA : pB).fee) * uf(r.startToken) + (r.amountMid * (r.buyPool === 0 ? pB : pA).fee) * uf(poolOther(pA, r.startToken)) : 0;
  const row = (a, v, cls = '') => `<tr class="${cls}"><td>${a}</td><td>${v}</td></tr>`;
  $('#ledger').innerHTML = `<caption class="sr">Where the money goes</caption>` + (r ? row('Gross profit, after swap fees', money(gross, t)) + row('Flash-loan fee', (fc > 0 ? '-' : '') + money(fc, t), fc > 0 ? 'minus' : '') + row('Gas', '-' + money(gc, t), 'minus') + row('Net profit', money(r.profit, t), 'total pos')
    : row('Gross profit', 'none at any size') + row('Gas per attempt', calc.toy ? 'n/a (toy pools)' : '-' + usd(gasUsd()), 'minus') + row('Net profit', calc.toy ? '0' : usd(0), 'total neg')) +
    (r ? `<tr><td colspan="2" style="font-size:13px;color:${COL.mute};border-top:0">Swap fees already paid inside the gross figure: ${calc.toy ? fmt(swapFees, 6) : usd(swapFees)}</td></tr>` : '');
  $('#recipe').innerHTML = r ? `<b>Recipe:</b> put ${sig(r.amountIn)} ${r.startToken} into pool ${r.buyPool === 0 ? 'A' : 'B'}, receive ${sig(r.amountMid)} ${poolOther(pA, r.startToken)}, sell it in pool ${r.buyPool === 0 ? 'B' : 'A'} for ${sig(r.amountOut)} ${r.startToken}.` +
    (calc.toy ? ` <span style="color:${COL.mute}">The original notebook, with its own fee convention and a fixed 10 DAI, reports 29.233166 ETH in and 0.035127 ETH profit; this is the optimum under v2 maths.</span>` : '') : '';
  // chart
  const wd = w || Math.round($('#arbSvg').parentNode.getBoundingClientRect().width) || 600, f = uf(st);
  const tryX = c.xmax * calc.tryFrac, tryY = (pathOutput(tryX, c.A_, c.B_, c.C_) - tryX - flash * tryX - c.g);
  profitChart($('#arbSvg'), wd, wd < 520 ? 290 : 400, { xs: c.xs, ys: c.ys.map(v => v * f), xmax: c.xmax, optX: r ? r.amountIn : 0, optY: r ? r.profit * f : 0, optLabel: r ? sig(r.amountIn) + ' ' + st : '', markX: tryX, markY: tryY * f,
    xfmt: v => v === 0 ? '0' : v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + 'k' : fmt(v, v < 10 ? 2 : 0), yfmt: v => calc.toy ? fmt(v, 2) : usd(v, Math.abs(v) < 10 ? 1 : 0), xlabel: `${st} sent into the first pool`, });
  $('#tryOut').textContent = `${sig(tryX)} ${st} → ${calc.toy ? fmt(tryY, 4) + ' ' + st : usd(tryY * f)}${r ? ` (${fmt(Math.max(0, tryY) / r.profit * 100, 0)}% of the best)` : ''}`;
}
function initArb() {
  ['#a0', '#a1', '#b0', '#b1', '#af', '#bf'].forEach(id => $(id).addEventListener('input', () => { if (id === '#b1' || id === '#a1' || id === '#a0' || id === '#b0') syncGapFromReserves(); $$('#arb [data-preset]').forEach(b => b.setAttribute('aria-pressed', false)); renderArb(); }));
  $('#gap').addEventListener('input', () => { applyGap(); setRange($('#gap')); $$('#arb [data-preset]').forEach(b => b.setAttribute('aria-pressed', false)); renderArb(); });
  $('#tryS').addEventListener('input', e => { calc.tryFrac = e.target.value / 1000; setRange(e.target); renderArb(); });
  $$('#arb [data-preset]').forEach(b => b.onclick = () => loadPreset(b.dataset.preset));
  calc.ready = true; setRange($('#tryS'));
  onWidth($('#arbSvg').parentNode, w => renderArb(w)); loadPreset('mainnet');
  $('#gap').value = 1; setRange($('#gap'));
}
$('#gap').setAttribute('min', '-5');
$('#gapOut').textContent = '';
const gapOutUpdate = () => { $('#gapOut').textContent = (num('#gap') >= 0 ? '+' : '') + num('#gap').toFixed(2) + '%'; };
$('#gap').addEventListener('input', gapOutUpdate); listeners.push(gapOutUpdate);

/* ---------------- cycle finder ---------------- */
const FAIR = { USD: 1, ETH: 2000, BTC: 40000, SOL: 100, ARB: 1, OP: 2 };
function defaultMarket() {
  const mk = (a, b, tvl, skew = 1, fee = 0.003) => mkPool(a, b, tvl / 2 / FAIR[a], tvl / 2 / FAIR[b] * skew, fee);
  return [mk('USD', 'ETH', 4e6), mk('ETH', 'BTC', 3e6), mk('BTC', 'USD', 3e6), mk('ETH', 'SOL', 1e6, 1.04), mk('SOL', 'USD', 1e6), mk('ARB', 'USD', 5e5), mk('OP', 'ARB', 4e5), mk('OP', 'USD', 4e5, 1, 0.01)];
}
const cy = { pools: defaultMarket(), cur: null, log: [], busy: false, seed: 1, anim: 0, geom: null };
function tokenPrices(pools) {
  const toks = [...new Set(pools.flatMap(p => [p.token0, p.token1]))], px = {}, root = toks.find(t => STABLE.has(t));
  if (!root) { toks.forEach(t => px[t] = 1); return px; }
  px[root] = 1; let changed = true;
  while (changed) { changed = false; for (const p of pools) { for (const [a, b, ra, rb] of [[p.token0, p.token1, p.reserve0, p.reserve1], [p.token1, p.token0, p.reserve1, p.reserve0]]) if (px[a] !== undefined && px[b] === undefined) { px[b] = px[a] * ra / rb; changed = true; } } }
  toks.forEach(t => { if (px[t] === undefined) px[t] = 0; }); return px;
}
function cycGas(pools) { const px = tokenPrices(pools), g = {}; for (const t in px) g[t] = px[t] > 0 ? gasUsd() / px[t] : 0; return { px, g }; }
function cycleSize(pools, cyc) {
  const { px, g } = cycGas(pools), start = cyc.some(e => STABLE.has(e[1])) ? cyc.find(e => STABLE.has(e[1]))[1] : cyc[0][1];
  const tr = sizeCycle(pools, cyc, start, g, A.flash); return { tr, px };
}
function renderTable() {
  const tb = $('#poolTable tbody'); if (tb.children.length !== cy.pools.length) {
    tb.innerHTML = cy.pools.map((p, i) => `<tr data-i="${i}"><td>${i + 1}</td><td></td><td><input type="number" step="any" data-k="reserve0" aria-label="Pool ${i + 1} first reserve"></td><td><input type="number" step="any" data-k="reserve1" aria-label="Pool ${i + 1} second reserve"></td><td><input type="number" step="0.01" data-k="fee" aria-label="Pool ${i + 1} fee percent"></td></tr>`).join('');
    tb.addEventListener('input', e => { const i = +e.target.closest('tr').dataset.i, k = e.target.dataset.k, v = +e.target.value; if (!(v >= 0)) return; if (k === 'fee') cy.pools[i].fee = v / 100; else cy.pools[i][k] = v; cy.cur = null; cy.stop = true; renderCycles(false); });
  }
  [...tb.children].forEach((tr, i) => { const p = cy.pools[i]; tr.children[1].textContent = `${p.token0}/${p.token1}`;
    const set = (k, v) => { const el = tr.querySelector(`[data-k=${k}]`); if (document.activeElement !== el) el.value = v; };
    set('reserve0', +p.reserve0.toPrecision(8)); set('reserve1', +p.reserve1.toPrecision(8)); set('fee', +(p.fee * 100).toFixed(3));
    tr.classList.toggle('hot', !!cy.cur && cy.cur.cycle.some(e => e[0] === i)); });
}
function renderCycles(redrawTable = true) {
  const svg = $('#cycSvg'), w = Math.round(svg.getBoundingClientRect().width) || 600, h = w < 520 ? 340 : 440;
  const toks = [...new Set(cy.pools.flatMap(p => [p.token0, p.token1]))], px = tokenPrices(cy.pools);
  const cx = w / 2, cyy = h / 2, R = Math.min(w / 2 - 54, h / 2 - 58), pos = {};
  toks.forEach((t, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / toks.length; pos[t] = [cx + R * Math.cos(a), cyy + R * Math.sin(a)]; });
  const seen = {}, edgeP = {};
  let s = '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#0B9A77"/></marker></defs>';
  cy.pools.forEach((p, i) => {
    const key = [p.token0, p.token1].sort().join('|'); const n = seen[key] = (seen[key] || 0) + 1; const [x0, y0] = pos[p.token0], [x1, y1] = pos[p.token1];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, off = (n - 1) * 34 * (n % 2 ? -1 : 1) * 0 + (n === 1 ? 0 : (n % 2 ? -1 : 1) * Math.ceil((n - 1) / 2) * 38);
    const qx = mx - dy / L * off * 2, qy = my + dx / L * off * 2; edgeP[i] = { x0, y0, x1, y1, qx, qy };
    s += `<path d="M${x0} ${y0}Q${qx} ${qy} ${x1} ${y1}" fill="none" stroke="#B9C2D4" stroke-width="${1.2 + Math.log10(1 + p.reserve0 * px[p.token0] * 2 / 1e5)}" opacity=".9"/>`;
    const lx = (x0 + 2 * qx + x1) / 4, ly = (y0 + 2 * qy + y1) / 4; s += `<g><circle cx="${lx}" cy="${ly}" r="9" fill="#fff" stroke="#B9C2D4"/><text x="${lx}" y="${ly + 3.8}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${COL.mute}">${i + 1}</text></g>`;
  });
  const hot = new Set(); let route = [];
  if (cy.cur) {
    cy.cur.cycle.forEach(([i, a, b]) => { const e = edgeP[i], fwd = a === cy.pools[i].token0, p0 = fwd ? [e.x0, e.y0] : [e.x1, e.y1], p1 = fwd ? [e.x1, e.y1] : [e.x0, e.y0];
      const sh = (p, q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [p[0] + (q[0] - p[0]) / d * 24, p[1] + (q[1] - p[1]) / d * 24]; };
      const ctl = [e.qx, e.qy], a0 = sh(p0, ctl), a1 = sh(p1, ctl); route.push([a0, ctl, a1]); hot.add(a); hot.add(b);
      s += `<path d="M${a0[0]} ${a0[1]}Q${ctl[0]} ${ctl[1]} ${a1[0]} ${a1[1]}" fill="none" stroke="${COL.mint}" stroke-width="3.6" stroke-dasharray="9 6" marker-end="url(#arr)" class="flow"/>`; });
  }
  toks.forEach(t => { const [x, y] = pos[t], on = hot.has(t); s += `<circle cx="${x}" cy="${y}" r="25" fill="${on ? '#E9F8F3' : '#fff'}" stroke="${on ? COL.mint : COL.ink}" stroke-width="${on ? 3 : 2}"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${COL.ink}">${t}</text><text x="${x}" y="${y + (y > cyy ? 44 : -34)}" text-anchor="middle" font-size="11.5" fill="${COL.mute}">${px[t] > 0 ? (px[t] >= 1000 ? '$' + fmt(px[t], 0) : '$' + fmt(px[t], px[t] < 10 ? 2 : 0)) : ''}</text>`; });
  s += `<circle id="coin" r="7" fill="${COL.usd}" stroke="#fff" stroke-width="2.5" display="none"/>`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('height', h); svg.innerHTML = s; cy.route = route;
  startCoin(); if (redrawTable !== false) renderTable(); else renderTable();
}
function startCoin() {
  cancelAnimationFrame(cy.anim); const coin = $('#coin'); if (!coin || !cy.route.length || REDUCED) return; coin.setAttribute('display', 'block');
  const q = (p, t) => { const u = 1 - t; return [u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0], u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1]]; };
  const n = cy.route.length, t0 = performance.now(), per = 900;
  const tick = now => { const c = $('#coin'); if (!c) return; const u = (Math.max(0, now - t0) / per) % n, i = Math.floor(u), pt = q(cy.route[i], u - i); c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]); cy.anim = requestAnimationFrame(tick); };
  cy.anim = requestAnimationFrame(tick);
}
function describeCycle(cyc) { return cyc.map(e => e[1]).concat(cyc[0][1]).join(' → '); }
function findAndShow() {
  const cyc = findNegativeCycle(cy.pools), passes = findNegativeCycle.passes, box = $('#cycRes');
  if (!cyc || new Set(cyc.map(e => e[0])).size < cyc.length) { cy.cur = null; $('#cExec').disabled = true; box.innerHTML = `<div class="big">No arbitrage loop</div><p style="margin:6px 0 0;color:${COL.mute}">Bellman-Ford made ${passes} passes over ${cy.pools.length * 2} edges and found no negative cycle: every loop loses at least the swap fees.</p>`; renderCycles(); return null; }
  const { tr, px } = cycleSize(cy.pools, cyc), f = px[tr.startToken] || 1; cy.cur = { cycle: tr.cycle, trade: tr, px };
  const net = tr.profit * f, gross = tr.grossProfit * f, ok = net > 0;
  const hops = []; { const w = cy.pools.map(copyPool); let amt = tr.amountIn; for (const [i, t, u] of tr.cycle) { const out = poolSwap(w[i], t, amt); hops.push(`Pool ${i + 1}: ${sig(amt)} ${t} → ${sig(out)} ${u}`); amt = out; } }
  box.innerHTML = `<div class="big ${ok ? 'pos' : 'neg'}">${ok ? 'Net ' + usd(net) + ' per attempt' : 'Loop exists, not worth sending'}</div>
    <div style="margin-top:4px">${describeCycle(tr.cycle)}, ×${tr.rate.toFixed(5)} per round trip at small size (${spct(tr.rate - 1)} before costs). ${ok ? '' : `Best case ${usd(gross)} is below gas of ${usd(tr.gasCost * f)}.`}</div>
    <div style="color:${COL.mute};font-size:14px;margin-top:4px">Send ${sig(tr.amountIn)} ${tr.startToken}; gross ${usd(gross)}, flash fee ${usd(tr.flashCost * f)}, gas ${usd(tr.gasCost * f)}. Found in ${passes} Bellman-Ford passes.</div><ol>${hops.map(h => `<li>${h}</li>`).join('')}</ol>`;
  $('#cExec').disabled = !ok; renderCycles(); return ok ? tr : null;
}
function executeCurrent() {
  if (!cy.cur) return false; const tr = cy.cur.trade, f = cy.cur.px[tr.startToken] || 1; if (tr.profit <= 0) return false;
  const path = describeCycle(tr.cycle); executeCycle(cy.pools, tr); cy.log.push({ n: cy.log.length + 1, path, net: tr.profit * f }); cy.cur = null; $('#cExec').disabled = true; renderLog(); renderCycles(); return true;
}
function renderLog() {
  const el = $('#cycLog'); if (!cy.log.length) { el.innerHTML = ''; return; }
  const tot = cy.log.reduce((a, b) => a + b.net, 0);
  el.innerHTML = `<table><thead><tr><th>#</th><th>Loop</th><th>Net</th></tr></thead><tbody>${cy.log.map(l => `<tr><td>${l.n}</td><td>${l.path}</td><td>${usd(l.net)}</td></tr>`).join('')}<tr><td></td><td><b>Total</b></td><td><b>${usd(tot)}</b></td></tr></tbody></table>`;
}
async function runFlat() {
  if (cy.busy) return; cy.busy = true; cy.stop = false; $('#cFlat').disabled = true;
  for (let i = 0; i < 25 && !cy.stop; i++) { const tr = findAndShow(); if (!tr) break; await new Promise(r => setTimeout(r, REDUCED ? 0 : 1300)); if (cy.stop) break; executeCurrent(); await new Promise(r => setTimeout(r, REDUCED ? 0 : 500)); }
  if (!cy.stop) { cy.cur = null; $('#cExec').disabled = true; renderCycles(); const tot = cy.log.reduce((s, l) => s + l.net, 0);
    $('#cycRes').innerHTML = `<div class="big">Market is flat</div><p style="margin:6px 0 0;color:${COL.mute}">${cy.log.length} trade${cy.log.length === 1 ? '' : 's'} earned ${usd(tot)} net. No remaining loop pays more than the gas of ${usd(gasUsd())}.</p>`; }
  cy.busy = false; $('#cFlat').disabled = false;
}
function initCycles() {
  $('#cFind').onclick = () => { cy.stop = true; findAndShow(); };
  $('#cExec').onclick = () => executeCurrent();
  $('#cFlat').onclick = runFlat;
  $('#cReset').onclick = () => { cy.stop = true; cy.pools = defaultMarket(); cy.cur = null; cy.log = []; $('#poolTable tbody').innerHTML = ''; renderLog(); $('#cycRes').innerHTML = ''; renderCycles(); };
  $('#cMis').onclick = () => { cy.stop = true; const r = () => (cy.seed = (cy.seed * 1664525 + 1013904223) >>> 0) / 4294967296, i = Math.floor(r() * cy.pools.length), f = 1 + (0.02 + r() * 0.04) * (r() < .5 ? -1 : 1); cy.pools[i].reserve1 *= f; cy.cur = null; $('#cycRes').innerHTML = `<p style="color:${COL.mute};margin:6px 0">Pool ${i + 1} (${cy.pools[i].token0}/${cy.pools[i].token1}) moved by ${spct(f - 1, 1)}. Find arbitrage to see whether a loop opened.</p>`; renderCycles(); };
  onWidth($('#cycSvg'), () => renderCycles());
  listeners.push(() => { if (cy.cur) findAndShow(); });
}

/* ---------------- LP lab ---------------- */
const lp = { fee: 0.003, res: null, rangeIdx: 0 };
const RANGES = [null, 0.5, 0.2, 0.1], RANGE_TXT = ['Full range (v2)', '-33% / +50%', '-17% / +20%', '-9% / +10%'];
const turnFromSlider = v => 0.001 * Math.pow(500, v / 1000);
function lpParams() { return { sigma: num('#vol') / 100, fee: lp.fee, turnover: turnFromSlider(num('#turn')), days: num('#hor'), tvl: Math.max(1000, num('#tvl')), pos: Math.max(1, num('#pos')) }; }
function runLP() {
  const P = lpParams(), spd = P.days > 200 ? 2 : 4, n = Math.round(P.days * spd), K = 70, rec = []; for (let j = 0; j <= K; j++) rec.push(Math.round(n * j / K));
  const t0 = performance.now(), res = simulateLP({ sigma: P.sigma, fee: P.fee, turnover: P.turnover, days: P.days, stepsPerDay: spd, nPaths: 500, seed: 12345, gas: gasUsd() / P.tvl, recordAt: rec });
  const s = summarise(res), bands = rec.map((_, j) => { const a = Float64Array.from(res.rec[j]).sort(); return [quantile(a, .05), quantile(a, .25), quantile(a, .5), quantile(a, .75), quantile(a, .95)]; });
  const sortedS = Float64Array.from(res.S).sort(); lp.res = { P, s, rec, bands, spd, n, meanArb: meanSe(res.arb)[0], sq: [quantile(sortedS, .05), quantile(sortedS, .5), quantile(sortedS, .95)], ms: performance.now() - t0 };
  renderLP();
}
function renderLP() {
  const R = lp.res; if (!R) return; const { P, s } = R;
  $('#vOut').textContent = Math.round(P.sigma * 100) + '%'; $('#tOut').textContent = pct(P.turnover, P.turnover < 0.01 ? 2 : 1); $('#hOut').textContent = P.days + ' days';
  ['#vol', '#turn', '#hor'].forEach(id => setRange($(id)));
  const be = breakEvenTurnover(P.sigma, P.fee);
  $('#beNote').innerHTML = `Rule of thumb: fee income matches the loss to arbitrageurs at about <b>${pct(be, be < 0.01 ? 2 : 1)} of the pool traded per day</b> (at ${Math.round(P.sigma * 100)}% volatility and ${pct(P.fee, 2)} fee). You chose ${pct(P.turnover, P.turnover < 0.01 ? 2 : 1)}.`;
  const win = s.meanNet > 0, fees = s.meanFees, lvr = s.meanLvr;
  $('#lpVerdict').innerHTML = `${win ? `<span class="pos">Fees win:</span> LP ${spct(s.meanNet, 2)} versus holding` : `<span class="neg">Loss wins:</span> LP ${spct(s.meanNet, 2)} versus holding`}<small>Mean after ${P.days} days over 500 paths (median ${spct(R.bands[R.bands.length - 1][2], 2)}). LP beats holding in ${Math.round(s.pWin * 100)}% of paths. Fee income is ${pct(fees)} of the position; loss to arbitrageurs ${pct(lvr)}.</small>`;
  // fan chart
  const svg = $('#fanSvg'), w = Math.round(svg.parentNode.getBoundingClientRect().width) || 700, h = w < 520 ? 300 : 380, m = { l: 68, r: 16, t: 14, b: 40 };
  const lo = Math.min(...R.bands.map(b => b[0])), hi = Math.max(...R.bands.map(b => b[4])), pad = (hi - lo) * 0.08 || 0.01;
  const X = lin(0, P.days, m.l, w - m.r), Y = lin((lo - pad) * 100, (hi + pad) * 100, h - m.b, m.t), days = R.rec.map(i => i / R.spd);
  let g = ''; for (const t of niceTicks((lo - pad) * 100, (hi + pad) * 100, 6)) g += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? COL.ink : COL.grid}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="12" fill="${COL.mute}">${t > 0 ? '+' : ''}${fmt(t, Math.abs(t) < 1 && t !== 0 ? 1 : 0)}%</text>`;
  for (const t of niceTicks(0, P.days, w < 520 ? 4 : 7)) g += `<text x="${X(t)}" y="${h - 20}" text-anchor="middle" font-size="12" fill="${COL.mute}">${fmt(t, 0)}</text>`;
  g += `<text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle" font-size="12.5" fill="${COL.mute}">days</text><text transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${COL.mute}">LP + fees minus holding, % of start</text>`;
  const band = (a, b) => 'M' + days.map((d, j) => `${X(d).toFixed(1)} ${Y(R.bands[j][a] * 100).toFixed(1)}`).join('L') + 'L' + days.map((d, j) => j).reverse().map(j => `${X(days[j]).toFixed(1)} ${Y(R.bands[j][b] * 100).toFixed(1)}`).join('L') + 'Z';
  g += `<path d="${band(0, 4)}" fill="${COL.eth}" opacity=".13"/><path d="${band(1, 3)}" fill="${COL.eth}" opacity=".24"/><path d="M${days.map((d, j) => `${X(d).toFixed(1)} ${Y(R.bands[j][2] * 100).toFixed(1)}`).join('L')}" fill="none" stroke="${COL.eth}" stroke-width="2.8"/>`;
  const last = R.bands[R.bands.length - 1]; g += `<text x="${w - m.r - 4}" y="${Y(last[4] * 100) - 6}" text-anchor="end" font-size="12" fill="${COL.eth}">best 5%</text><text x="${w - m.r - 4}" y="${Y(last[0] * 100) + 15}" text-anchor="end" font-size="12" fill="${COL.eth}">worst 5%</text><text x="${w - m.r - 4}" y="${Y(last[2] * 100) - 8}" text-anchor="end" font-size="13" font-weight="700" fill="${COL.ink}">median ${spct(last[2], 2)}</text>`;
  g += `<g id="fanHover" display="none"><line y1="${m.t}" y2="${h - m.b}" stroke="${COL.ink}" stroke-dasharray="3 3"/><text font-size="12.5" font-weight="600" fill="${COL.ink}"></text></g><rect x="${m.l}" y="${m.t}" width="${w - m.l - m.r}" height="${h - m.t - m.b}" fill="transparent" id="fanHit"/>`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('height', h); svg.innerHTML = g;
  const hit = $('#fanHit'), hv = $('#fanHover'); hit.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * w / r.width, d = (x - m.l) / (w - m.l - m.r) * P.days, j = Math.max(0, Math.min(days.length - 1, Math.round(d / P.days * (days.length - 1)))), b = R.bands[j];
    hv.setAttribute('display', 'block'); const lx = X(days[j]); hv.querySelector('line').setAttribute('x1', lx); hv.querySelector('line').setAttribute('x2', lx); const t = hv.querySelector('text'); t.textContent = `day ${fmt(days[j], 0)}: median ${spct(b[2], 2)}, 5-95% ${spct(b[0], 1)} to ${spct(b[4], 1)}`; t.setAttribute('x', lx > w / 2 ? lx - 8 : lx + 8); t.setAttribute('text-anchor', lx > w / 2 ? 'end' : 'start'); t.setAttribute('y', m.t + 14); });
  hit.addEventListener('pointerleave', () => hv.setAttribute('display', 'none'));
  // earnings
  const k = P.pos, feeD = s.meanFees * k, lvrD = s.meanLvr * k, arbD = R.meanArb * k, gasD = lvrD - arbD, netD = s.meanNet * k;
  const rows = [['You earn in fees', 'from uninformed volume', feeD, COL.mint], ['You lose to arbitrageurs', 'loss versus rebalancing, after the fees they pay', -lvrD, COL.coral], ['Arbitrageurs keep', 'their net profit after gas', arbD, COL.usd], ['Validators receive', 'gas paid by arbitrageurs', gasD, COL.mute]];
  const mx = Math.max(...rows.map(r => Math.abs(r[2])), 1e-9);
  $('#earn').innerHTML = rows.map(([a, b, v, c]) => `<div class="earn-row"><span>${a}<em>${b}</em></span><b style="color:${v < 0 ? COL.coral : COL.ink}">${v < 0 ? '-' : '+'}${usd(Math.abs(v), 0)}</b><div class="bar"><i style="width:${Math.abs(v) / mx * 100}%;background:${c}"></i></div></div>`).join('') +
    `<div class="earn-row" style="border-top:2px solid ${COL.ink};padding-top:8px"><span><b>You, versus just holding</b><em>fees plus impermanent loss</em></span><b style="color:${netD < 0 ? COL.coral : COL.mint}">${netD < 0 ? '-' : '+'}${usd(Math.abs(netD), 0)}</b></div>`;
  renderIL();
}
function renderIL() {
  const R = lp.res; if (!R) return; const svg = $('#ilSvg'), w = Math.round(svg.parentNode.getBoundingClientRect().width) || 360, h = 240, m = { l: 46, r: 10, t: 10, b: 34 };
  const wv = RANGES[lp.rangeIdx], pa = wv ? 1 / (1 + wv) : null, pb = wv ? 1 + wv : null;
  $('#rOut').textContent = RANGE_TXT[lp.rangeIdx] + (wv ? `, ${fmt(v3ConcentrationFactor(1, pa, pb), 1)}x capital efficiency` : ''); setRange($('#rng'));
  const lx = Math.log2, X = lin(lx(0.25), lx(4), m.l, w - m.r), rs = []; for (let i = 0; i <= 120; i++) rs.push(Math.pow(2, lx(0.25) + (lx(4) - lx(0.25)) * i / 120));
  const full = rs.map(r => impermanentLoss(r) * 100), rngv = wv ? rs.map(r => v3IlVsHodl(r, 1, pa, pb) * 100) : null, ymin = Math.min(...full, ...(rngv || [0]), -5), Y = lin(ymin * 1.05, 0, h - m.b, m.t + 4);
  let s = ''; for (const t of niceTicks(ymin, 0, 4)) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${COL.grid}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11.5" fill="${COL.mute}">${fmt(t, 0)}%</text>`;
  for (const t of [0.25, 0.5, 1, 2, 4]) s += `<text x="${X(lx(t))}" y="${h - 14}" text-anchor="middle" font-size="11.5" fill="${COL.mute}">${t}×</text>`;
  const [q5, q50, q95] = R.sq; s += `<rect x="${X(lx(Math.max(0.25, q5)))}" width="${Math.max(2, X(lx(Math.min(4, q95))) - X(lx(Math.max(0.25, q5))))}" y="${m.t}" height="${h - m.b - m.t}" fill="${COL.eth}" opacity=".08"/><line x1="${X(lx(Math.min(4, Math.max(.25, q50))))}" x2="${X(lx(Math.min(4, Math.max(.25, q50))))}" y1="${m.t}" y2="${h - m.b}" stroke="${COL.eth}" stroke-dasharray="3 3"/>`;
  const path = arr => 'M' + arr.map((v, i) => `${X(lx(rs[i])).toFixed(1)} ${Y(v).toFixed(1)}`).join('L');
  s += `<path d="${path(full)}" fill="none" stroke="${COL.eth}" stroke-width="2.6"/>` + (rngv ? `<path d="${path(rngv)}" fill="none" stroke="${COL.usd}" stroke-width="2.6"/>` : '');
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h + 2}" text-anchor="middle" font-size="11" fill="${COL.mute}">end price ÷ start price (shaded: 5-95% of paths)</text>`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h + 6}`); svg.setAttribute('height', h + 6); svg.innerHTML = s;
}
function initLP() {
  const go = later(runLP);
  ['#vol', '#turn', '#hor', '#tvl', '#pos'].forEach(id => $(id).addEventListener('input', go));
  $$('#feeSeg .chip').forEach(b => b.onclick = () => { lp.fee = +b.dataset.fee; $$('#feeSeg .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); go(); });
  $('#rng').addEventListener('input', e => { lp.rangeIdx = +e.target.value; renderIL(); });
  onWidth($('#fanSvg').parentNode, () => renderLP());
  listeners.push(go); go();
}

/* ---------------- boot ---------------- */
readAssumptions();
$('#turn').value = 629;
listeners.push(() => { renderHero(); renderArb(); });
initCurve(); initArb(); initCycles(); initLP();
gapOutUpdate(); $('#gap').addEventListener('input', gapOutUpdate);
renderCycles(); renderHero(REDUCED ? null : 0); findAndShow();
onWidth($('#heroSvg'), () => { if (hero.done && !hero.running) renderHero(); });
setTimeout(() => { hero.done = true; heroAnimate(); }, 250);
})();
