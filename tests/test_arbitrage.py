import random

import pytest

from amm import Pool, brute_force_optimum, mobius_coeffs, profit_curve, two_pool_arbitrage
from amm.arbitrage import optimal_input, simulate_route


def test_closed_form_equals_brute_force_on_random_pools():
    rng = random.Random(11)
    checked = 0
    for _ in range(60):
        a = Pool("X", "Y", rng.uniform(50, 5000), rng.uniform(50, 5000), fee=rng.choice([0.0005, 0.003, 0.01]))
        b = Pool("X", "Y", rng.uniform(50, 5000), rng.uniform(50, 5000), fee=rng.choice([0.0005, 0.003, 0.01]))
        res = two_pool_arbitrage(a, b)
        if res is None:
            continue
        checked += 1
        first, second = (a, b) if res.buy_pool == 0 else (b, a)
        a_bf, p_bf = brute_force_optimum(first, second, res.start_token, grid=2001)
        assert res.profit == pytest.approx(p_bf, rel=1e-9)
        assert res.amount_in == pytest.approx(a_bf, rel=1e-5)
    assert checked > 20


def test_profit_is_concave_with_peak_at_closed_form():
    a, b = Pool("DAI", "ETH", 400, 1200), Pool("DAI", "ETH", 2000, 5800)
    r = two_pool_arbitrage(a, b)
    first, second = (a, b) if r.buy_pool == 0 else (b, a)
    h = 1e-3 * r.amount_in
    xs = [r.amount_in - h, r.amount_in, r.amount_in + h]
    ys = profit_curve(first, second, r.start_token, xs)
    assert ys[1] > ys[0] and ys[1] > ys[2]


def test_mobius_matches_swaps():
    a, b = Pool("X", "Y", 300, 900), Pool("X", "Y", 700, 1900, fee=0.01)
    A, B, C = mobius_coeffs([(*a.reserves("Y"), a.gamma), (*b.reserves("X"), b.gamma)])
    amt = 12.5
    assert A * amt / (B + C * amt) - amt == pytest.approx(simulate_route(a, b, "Y", amt), rel=1e-12)


def test_no_arbitrage_inside_fee_band():
    a = Pool("X", "Y", 1000, 1000)
    b = Pool("X", "Y", 1000, 1000 * 1.005)  # 0.5% gap < 2 x 0.3% fees
    assert two_pool_arbitrage(a, b) is None
    c = Pool("X", "Y", 1000, 1000 * 1.007)  # 0.7% gap > 0.6%
    assert two_pool_arbitrage(a, c) is not None


def test_executing_optimum_realises_predicted_profit_and_closes_gap():
    a, b = Pool("DAI", "ETH", 400, 1200), Pool("DAI", "ETH", 2000, 5800)
    r = two_pool_arbitrage(a, b)
    first, second = (a, b) if r.buy_pool == 0 else (b, a)
    mid = first.swap(r.start_token, r.amount_in)
    back = second.swap(first.other(r.start_token), mid)
    assert back - r.amount_in == pytest.approx(r.profit, rel=1e-12)
    assert two_pool_arbitrage(a, b) is None or two_pool_arbitrage(a, b).profit < 1e-9


def test_optimal_input_zero_when_unprofitable():
    assert optimal_input(1.0, 2.0, 1.0) == (0.0, 0.0)


def test_flash_fee_optimum_matches_brute_force_and_closed_form():
    a, b = Pool("ETH", "USDC", 10_000, 20e6), Pool("ETH", "USDC", 10_000, 20e6 * 1.01)
    for phi in (0.0, 0.0005, 0.0009):
        r = two_pool_arbitrage(a, b, flash_fee=phi)
        first, second = (a, b) if r.buy_pool == 0 else (b, a)
        # net profit as a function of size, using only swap quotes
        f = lambda x: simulate_route(first, second, r.start_token, x) - phi * x
        assert f(r.amount_in) == pytest.approx(r.profit, rel=1e-9)
        assert f(r.amount_in) >= f(r.amount_in * 1.001) and f(r.amount_in) >= f(r.amount_in * 0.999)
        assert r.profit == pytest.approx(r.gross_profit - r.flash_cost, rel=1e-9)


def test_gas_subtracts_and_sets_break_even_gap():
    from amm import breakeven_mispricing
    pool = Pool("ETH", "USDC", 10_000, 20e6)
    free = breakeven_mispricing(pool)
    assert free == pytest.approx(0.006, abs=1e-4)                  # two 0.3% fees
    gas = {"USDC": 6.0, "ETH": 6.0 / 2000}  # $6 either way
    g = breakeven_mispricing(pool, gas)
    assert g > free
    twin = Pool("ETH", "USDC", 10_000, 20e6 * (1 + g * 1.001))
    assert two_pool_arbitrage(pool, twin, gas) is not None
    twin = Pool("ETH", "USDC", 10_000, 20e6 * (1 + g * 0.999))
    assert two_pool_arbitrage(pool, twin, gas) is None
    # gas is a fixed cost: the optimal size does not change
    big = Pool("ETH", "USDC", 10_000, 20e6 * 1.01)
    assert two_pool_arbitrage(pool, big, gas).amount_in == pytest.approx(two_pool_arbitrage(pool, big).amount_in)
