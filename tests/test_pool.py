import math
import random

import pytest

from amm import Pool, amount_in, amount_out


def test_amount_out_matches_formula():
    # x_in * gamma * R_out / (R_in + x_in * gamma)
    assert amount_out(10, 100, 200, 0.003) == pytest.approx(10 * 0.997 * 200 / (100 + 10 * 0.997))


def test_zero_fee_preserves_k_exactly():
    p = Pool("X", "Y", 1000, 2000, fee=0.0)
    k0 = p.k
    p.swap("X", 123.4)
    assert p.k == pytest.approx(k0, rel=1e-12)


def test_k_never_decreases_with_fee():
    rng = random.Random(3)
    p = Pool("X", "Y", 1000, 2500)
    k = p.k
    for _ in range(500):
        tok = rng.choice(["X", "Y"])
        r_in, _ = p.reserves(tok)
        p.swap(tok, rng.uniform(0, 0.3) * r_in)
        assert p.k >= k * (1 - 1e-15)
        k = p.k


def test_k_growth_matches_fee_revenue():
    p = Pool("X", "Y", 1000, 1000)
    x_in = 100.0
    p.swap("X", x_in)
    # new k = (R + x) * R*R/(R + g*x) ; strictly above R*R
    assert p.k == pytest.approx(1e6 * (1100) / (1000 + 0.997 * 100))
    assert p.k > 1e6


def test_quote_in_inverts_quote_out():
    p = Pool("X", "Y", 500, 800)
    out = p.quote_out("X", 37.0)
    assert p.quote_in("Y", out) == pytest.approx(37.0, rel=1e-12)


def test_round_trip_loses_money():
    p = Pool("X", "Y", 500, 800)
    got = p.swap("X", 10.0)
    back = p.swap("Y", got)
    assert back < 10.0


def test_marginal_rate_is_derivative_of_output():
    p = Pool("X", "Y", 500, 800)
    h = 1e-6
    deriv = (p.quote_out("X", h) - p.quote_out("X", 0.0)) / h
    assert deriv == pytest.approx(p.rate("X"), rel=1e-5)


def test_exact_out_bounds():
    with pytest.raises(ValueError):
        amount_in(200, 100, 200)
