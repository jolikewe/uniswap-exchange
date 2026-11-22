import numpy as np
import pytest

from amm import (Pool, arbitrage_to_price, break_even_turnover, expected_lvr_fraction,
                 impermanent_loss, simulate_lp, summarise)
from amm import v3


def test_il_known_values():
    assert impermanent_loss(1.0) == 0.0
    assert impermanent_loss(4.0) == pytest.approx(-0.2)           # 2*2/5 - 1
    assert impermanent_loss(2.0) == pytest.approx(-0.05719095841793653)
    assert impermanent_loss(0.25) == pytest.approx(impermanent_loss(4.0))  # symmetric in log r


def test_il_formula_matches_pool_simulation():
    # Move the external price in one step with fee 0: pool/HODL must equal 1 + IL(r)
    for r in (0.25, 0.5, 0.9, 1.3, 2.0, 5.0):
        p = Pool("X", "Y", 1000.0, 1000.0, fee=0.0)  # price 1
        x, y, _ = arbitrage_to_price(p.reserve0, p.reserve1, r, 0.0)
        pool_v = x * r + y
        hodl_v = 1000.0 * r + 1000.0
        assert pool_v / hodl_v - 1 == pytest.approx(impermanent_loss(r), rel=1e-12)


def test_arbitrage_lands_inside_fee_band_and_k_grows():
    rng = np.random.default_rng(0)
    for _ in range(200):
        x, y = rng.uniform(10, 1e3, 2)
        S = float(np.exp(rng.normal(0, 0.5)) * y / x)
        for fee in (0.0005, 0.003, 0.01):
            g = 1 - fee
            x2, y2, prof = arbitrage_to_price(x, y, S, fee)
            assert g * S * (1 - 1e-9) <= y2 / x2 <= S / g * (1 + 1e-9)
            assert x2 * y2 >= x * y * (1 - 1e-12)
            assert prof >= -1e-12


def test_arbitrage_matches_explicit_swap():
    p = Pool("X", "Y", 100.0, 300.0)
    S = 3.6  # pool price 3 is too low
    x2, y2, _ = arbitrage_to_price(p.reserve0, p.reserve1, S, p.fee)
    dy = (np.sqrt(p.gamma * p.k * S) - p.reserve1) / p.gamma
    p.swap("Y", float(dy))
    assert (p.reserve0, p.reserve1) == pytest.approx((float(x2), float(y2)), rel=1e-12)


def test_mc_expected_lvr_matches_closed_form_zero_fee():
    sigma, years = 0.8, 1.0
    res = simulate_lp(sigma, fee=0.0, days=365, steps_per_day=2, n_paths=6000, seed=7)
    s = summarise(res)
    exact = expected_lvr_fraction(sigma, years)
    assert abs(s["mean_lvr"] - exact) < 4 * s["se_lvr"]
    # and E[pool - HODL] equals the same number (martingale identity)
    assert abs(-s["mean_il"] - exact) < 4 * s["se_net"]


def test_mc_il_pathwise_matches_formula():
    res = simulate_lp(0.6, fee=0.0, days=60, steps_per_day=4, n_paths=50, seed=2)
    r = res["S"][:, -1]
    assert (res["pool"][:, -1] / res["hodl"][:, -1] - 1) == pytest.approx(impermanent_loss(r), rel=1e-9)


def test_fees_can_compensate_il():
    low = summarise(simulate_lp(0.8, 0.003, turnover=0.0, days=90, n_paths=1500, seed=1))
    high = summarise(simulate_lp(0.8, 0.003, turnover=0.2, days=90, n_paths=1500, seed=1))
    assert low["mean_net"] < 0 < high["mean_net"]
    assert high["mean_fees"] > low["mean_fees"] == 0.0


def test_break_even_turnover_rule():
    # 80% vol, 0.3% fee -> sigma^2/8/365/f
    assert break_even_turnover(0.8, 0.003) == pytest.approx(0.64 / 8 / 365 / 0.003)


def test_v3_matches_v2_for_wide_range_and_amplifies_il_when_narrow():
    p = np.array([0.5, 0.8, 1.0, 1.25, 2.0])
    wide = v3.il_versus_hodl(p, 1.0, 1e-9, 1e9)
    assert wide == pytest.approx(impermanent_loss(p), abs=1e-4)
    narrow = v3.il_versus_hodl(p, 1.0, 0.8, 1.25)
    assert narrow[0] < impermanent_loss(0.5) and narrow[-1] < impermanent_loss(2.0)
    assert v3.concentration_factor(1.0, 0.8, 1.25) > 5


def test_v3_value_is_continuous_at_range_edges():
    L = v3.liquidity_from_value(1.0, 1.0, 0.8, 1.25)
    assert v3.position_value(L, 1.0, 0.8, 1.25) == pytest.approx(1.0)
    eps = 1e-9
    assert v3.position_value(L, 1.25 - eps, 0.8, 1.25) == pytest.approx(v3.position_value(L, 1.25 + eps, 0.8, 1.25), rel=1e-6)


def test_gas_widens_no_trade_band_and_cuts_arb_profit():
    free = simulate_lp(0.8, 0.003, days=30, steps_per_day=24, n_paths=300, seed=4)
    costly = simulate_lp(0.8, 0.003, days=30, steps_per_day=24, n_paths=300, seed=4, gas=2e-6)
    assert costly["arb_profit"][:, -1].mean() < free["arb_profit"][:, -1].mean()


def test_lp_lvr_equals_arbitrageur_profit_without_gas():
    res = simulate_lp(0.8, 0.003, days=30, steps_per_day=8, n_paths=50, seed=12)
    assert res["lvr"][:, -1] == pytest.approx(res["arb_profit"][:, -1], rel=1e-9)
