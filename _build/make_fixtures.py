"""Write fixtures.json: reference outputs of the Python package for the JS port to match.

Usage (from this folder):  python3 make_fixtures.py [path/to/repo]   (default ../../uniswap-exchange-main)
"""
import json, math, random, sys, pathlib
import numpy as np

repo = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../../uniswap-exchange-main").resolve()
sys.path.insert(0, str(repo))
from amm import (Pool, two_pool_arbitrage, breakeven_mispricing, profit_curve, brute_force_optimum, find_negative_cycle,
                 size_cycle, arbitrage_until_flat, impermanent_loss, arbitrage_to_price, simulate_lp, summarise,
                 expected_lvr_fraction, break_even_turnover)
from amm import v3
from amm.cycles import cycle_rate, execute_cycle
from amm.legacy import NotebookPool, calculate_arbitrage

rng = random.Random(42)
P = lambda p: [p.token0, p.token1, p.reserve0, p.reserve1, p.fee]
out = {}

# pool swaps
cases = []
for _ in range(20):
    p = Pool("X", "Y", rng.uniform(50, 5000), rng.uniform(50, 5000), rng.choice([0.0005, 0.003, 0.01]))
    tok = rng.choice(["X", "Y"]); x = rng.uniform(0.1, 0.4) * p.reserves(tok)[0]
    q = p.copy(); o = q.swap(tok, x)
    cases.append({"pool": P(p), "tok": tok, "x": x, "out": o, "r0": q.reserve0, "r1": q.reserve1, "k": q.k, "rate": p.rate(tok)})
out["swaps"] = cases

# two-pool arbitrage with gas / flash fee
arbs = []
for _ in range(40):
    a = Pool("X", "Y", rng.uniform(50, 5000), rng.uniform(50, 5000), rng.choice([0.0005, 0.003, 0.01]))
    b = Pool("X", "Y", a.reserve0 * rng.uniform(.5, 2), a.reserve1 * rng.uniform(.9, 1.15), rng.choice([0.0005, 0.003, 0.01]))
    gas = {"X": rng.choice([0, 0.01, 0.2]), "Y": rng.choice([0, 0.01, 0.2])}; flash = rng.choice([0, 0.0005, 0.0009])
    r = two_pool_arbitrage(a, b, gas, flash)
    row = {"p1": P(a), "p2": P(b), "gas": gas, "flash": flash, "res": None}
    if r:
        row["res"] = {k: getattr(r, k) for k in ("start_token", "buy_pool", "amount_in", "amount_mid", "amount_out", "profit", "price_gap", "gross_profit", "flash_cost", "gas_cost")}
        first, second = (a, b) if r.buy_pool == 0 else (b, a)
        row["curve_x"] = [r.amount_in * f for f in (0.1, 0.5, 1, 2, 3)]
        row["curve_y"] = profit_curve(first, second, r.start_token, row["curve_x"]).tolist()
    arbs.append(row)
out["arbs"] = arbs
base = Pool("ETH", "USDC", 10_000, 20e6)
out["breakeven"] = [{"gas": g, "flash": f, "gap": breakeven_mispricing(base, {"USDC": g, "ETH": g / 2000}, f)} for g in (0, 6, 30) for f in (0, 0.0005)]

# notebook reproduction (legacy model)
a, b = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 5800)
req, prof, name = calculate_arbitrage(a, b, 10)
a2, b2 = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 5700)
r2, p2, _ = calculate_arbitrage(a2, b2, 10); b2.swap(input_eth=r2)
pa, pb = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 6000)
pa.swap(input_dai=100); k1 = pa.k; pa.swap(input_eth=200); pb.swap(input_eth=50)
out["notebook"] = {"required": req, "profit": prof, "pool": name, "bench_required": r2, "bench_profit": p2,
                   "bench_b": [b2.dai, b2.eth, b2.k], "a_after_1": [500.3, 960.0, k1], "a_after_2": [pa.dai, pa.eth, pa.k], "b_after_3": [pb.dai, pb.eth, pb.k]}

# cycles
def market(r, n_tok=6, n_pool=9, mis=0.03):
    toks = [f"T{i}" for i in range(n_tok)]; px = {t: math.exp(r.gauss(0, 1)) for t in toks}; ps = []
    for _ in range(n_pool):
        x, y = r.sample(toks, 2); d = r.uniform(1e3, 1e5)
        ps.append(Pool(x, y, d / px[x], d * math.exp(r.gauss(0, mis)) / px[y], r.choice([0.003, 0.003, 0.01])))
    return ps
cyc = []
for _ in range(25):
    ps = market(rng); c = find_negative_cycle(ps)
    gas = {t: 0.5 for t in {p.token0 for p in ps} | {p.token1 for p in ps}}; flash = rng.choice([0, 0.0005])
    row = {"pools": [P(p) for p in ps], "gas": gas, "flash": flash, "cycle": c}
    if c:
        t = size_cycle(ps, c, gas=gas, flash_fee=flash)
        row["trade"] = {"start": t.start_token, "in": t.amount_in, "out": t.amount_out, "profit": t.profit, "gross": t.gross_profit, "rate": t.rate}
        trades, flat = arbitrage_until_flat(ps, gas=gas, flash_fee=flash)
        row["flat"] = {"n": len(trades), "profits": [x.profit for x in trades], "reserves": [[p.reserve0, p.reserve1] for p in flat]}
    cyc.append(row)
out["cycles"] = cyc

# IL, arbitrage step, v3
rs = [0.1, 0.25, 0.5, 0.9, 1.0, 1.3, 2, 5, 10]
out["il"] = {"r": rs, "il": impermanent_loss(rs).tolist(), "lvr": expected_lvr_fraction(0.8, 1.0), "be": break_even_turnover(0.8, 0.003)}
steps = []
for _ in range(30):
    x, y = rng.uniform(10, 1e3), rng.uniform(10, 1e3); S = y / x * math.exp(rng.gauss(0, .05)); fee = rng.choice([0, 0.003, 0.01]); gas = rng.choice([0, 0.5])
    xn, yn, pr = arbitrage_to_price(x, y, S, fee, gas)
    steps.append({"x": x, "y": y, "S": S, "fee": fee, "gas": gas, "out": [float(xn), float(yn), float(pr)]})
out["arbstep"] = steps
ps_ = np.array([0.5, 0.8, 1.0, 1.25, 2.0])
out["v3"] = {"p": ps_.tolist(), "il_a": v3.il_versus_hodl(ps_, 1.0, 0.8, 1.25).tolist(), "il_b": v3.il_versus_hodl(ps_, 1.0, 1 / 1.5, 1.5).tolist(),
             "cf": [v3.concentration_factor(1.0, 0.8, 1.25), v3.concentration_factor(1.0, 1 / 1.1, 1.1)]}

# LP simulation on a shared normal matrix (deterministic comparison)
Z = np.random.default_rng(5).standard_normal((12, 48))
cfgs = []
for cfg in [dict(sigma=0.8, fee=0.003, turnover=0.05, days=12, steps_per_day=4), dict(sigma=0.5, fee=0.0, turnover=0.0, days=12, steps_per_day=4),
            dict(sigma=1.2, fee=0.01, turnover=0.1, days=12, steps_per_day=4, gas=2e-4, mu=0.3)]:
    r = simulate_lp(Z=Z, **cfg)
    cfgs.append({"cfg": cfg, "net": r["net"][:, -1].tolist(), "il": r["il"][:, -1].tolist(), "fees": (r["fees"][:, -1]).tolist(),
                 "lvr": r["lvr"][:, -1].tolist(), "arb": r["arb_profit"][:, -1].tolist(), "S": r["S"][:, -1].tolist(), "rec": [r["net"][:, 24].tolist()]})
out["lp_det"] = {"Z": Z.tolist(), "cases": cfgs}
# LP Monte Carlo statistics from numpy (large n) for a statistical comparison with the JS generator
stats = []
for cfg in [dict(sigma=0.8, fee=0.003, turnover=0.05, days=90, steps_per_day=4), dict(sigma=0.4, fee=0.0, turnover=0.0, days=90, steps_per_day=4),
            dict(sigma=1.0, fee=0.01, turnover=0.1, days=60, steps_per_day=4, gas=1e-4)]:
    s = summarise(simulate_lp(n_paths=20000, seed=99, **cfg)); stats.append({"cfg": cfg, "mean_net": s["mean_net"], "se_net": s["se_net"], "p_win": s["p_lp_beats_hodl"], "mean_lvr": s["mean_lvr"], "se_lvr": s["se_lvr"], "mean_fees": s["mean_fees"]})
out["lp_stats"] = stats
json.dump(out, open("fixtures.json", "w"))
print("fixtures.json written:", pathlib.Path("fixtures.json").stat().st_size, "bytes")
