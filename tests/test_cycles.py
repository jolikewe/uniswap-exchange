import math
import random

import pytest

from amm import Pool, arbitrage_until_flat, best_cycle, find_negative_cycle, size_cycle
from amm.arbitrage import brute_force_optimum
from amm.cycles import cycle_rate, execute_cycle


def random_pools(rng, n_tokens=5, n_pools=7, mispricing=0.15):
    tokens = [f"T{i}" for i in range(n_tokens)]
    px = {t: math.exp(rng.gauss(0, 1)) for t in tokens}
    pools = []
    for _ in range(n_pools):
        a, b = rng.sample(tokens, 2)
        depth = rng.uniform(1e3, 1e5)
        noise = math.exp(rng.gauss(0, mispricing))
        pools.append(Pool(a, b, depth / px[a], depth * noise / px[b]))
    return pools


def test_no_cycle_when_prices_consistent():
    pools = [Pool("A", "B", 100, 200), Pool("B", "C", 200, 600), Pool("C", "A", 600, 100)]
    assert find_negative_cycle(pools) is None


def test_detects_and_sizes_triangle():
    pools = [Pool("A", "B", 100, 200), Pool("B", "C", 100, 300), Pool("C", "A", 300, 150)]
    cyc = find_negative_cycle(pools)
    assert cyc is not None and cycle_rate(pools, cyc) > 1
    t = size_cycle(pools, cyc)
    work = [p.copy() for p in pools]
    out = execute_cycle(work, t)
    assert out - t.amount_in == pytest.approx(t.profit, rel=1e-12)


def test_cycle_size_is_optimal_numerically():
    pools = [Pool("A", "B", 100, 200), Pool("B", "C", 100, 300), Pool("C", "A", 300, 150)]
    t = size_cycle(pools, find_negative_cycle(pools))

    def profit(a):
        work = [p.copy() for p in pools]
        t2 = type(t)(t.cycle, t.start_token, a, 0, 0, 0)
        return execute_cycle(work, t2) - a

    assert profit(t.amount_in) >= profit(t.amount_in * 1.01)
    assert profit(t.amount_in) >= profit(t.amount_in * 0.99)
    assert profit(t.amount_in) == pytest.approx(t.profit, rel=1e-12)


def test_two_pool_cycle_matches_two_pool_formula():
    from amm import two_pool_arbitrage
    a, b = Pool("DAI", "ETH", 400, 1200), Pool("DAI", "ETH", 2000, 5800)
    cyc = find_negative_cycle([a, b])
    r = two_pool_arbitrage(a, b)
    t = size_cycle([a, b], cyc, start_token=r.start_token)
    assert t.profit == pytest.approx(r.profit, rel=1e-9)
    assert t.start_token == r.start_token


def test_bellman_ford_agrees_with_exhaustive_search():
    rng = random.Random(5)
    for _ in range(200):
        pools = random_pools(rng)
        cyc = find_negative_cycle(pools)
        ref = best_cycle(pools, max_len=5)
        # BF may report a cycle with a repeated pool only if a profitable simple cycle exists
        if ref is None:
            assert cyc is None or cycle_rate(pools, cyc) <= 1 + 1e-9
        else:
            assert cyc is not None and cycle_rate(pools, cyc) > 1


def test_loop_ends_with_no_cycle_and_profit_is_positive():
    rng = random.Random(9)
    for _ in range(20):
        pools = random_pools(rng, mispricing=0.25)
        trades, final = arbitrage_until_flat(pools, max_iter=500)
        assert all(t.profit > 0 for t in trades)
        cyc = find_negative_cycle(final)
        assert cyc is None or cycle_rate(final, cyc) < 1 + 1e-9
        for p0, p1 in zip(pools, final):
            assert p1.k >= p0.k
