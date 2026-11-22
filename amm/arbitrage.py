"""Optimal arbitrage sizing for constant-product pools (closed form).

Each constant-product hop is a Moebius map  a -> alpha*a / (beta + delta*a)  with
alpha = gamma*R_out, beta = R_in, delta = gamma. Compositions of such maps keep
the shape  a -> A*a / (B + C*a),  composed by

    A' = alpha*A,   B' = beta*B,   C' = beta*C + delta*A.

Profit(a) = A*a/(B + C*a) - a is concave for a >= 0 with maximum at

    a* = (sqrt(A*B) - B) / C,      profit* = (sqrt(A) - sqrt(B))**2 / C,

which exists iff A > B (the round trip is profitable at infinitesimal size).
The same formula sizes any cycle through any number of pools.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np

from .pool import Pool

Hop = tuple[float, float, float]  # (r_in, r_out, gamma)


def mobius_coeffs(hops: Sequence[Hop]) -> tuple[float, float, float]:
    """Coefficients (A, B, C) of the composed map  a -> A*a / (B + C*a)."""
    A, B, C = 1.0, 1.0, 0.0
    for r_in, r_out, g in hops:
        alpha, beta, delta = g * r_out, r_in, g
        A, B, C = alpha * A, beta * B, beta * C + delta * A
    return A, B, C


def path_output(a, A: float, B: float, C: float):
    return A * a / (B + C * a)


def optimal_input(A: float, B: float, C: float, flash_fee: float = 0.0) -> tuple[float, float]:
    """(a*, profit*) for the composed map; (0, 0) when no profitable trade exists.

    ``flash_fee`` is a proportional fee phi on the borrowed input (lambda = 1 + phi).
    Maximising A*a/(B + C*a) - lambda*a gives

        a* = (sqrt(A*B/lambda) - B) / C,      profit* = (sqrt(A) - sqrt(lambda*B))**2 / C,

    profitable iff A > lambda*B. A fixed gas cost does not move a*; it is subtracted
    from profit* afterwards.
    """
    lam = 1.0 + flash_fee
    if A <= lam * B:
        return 0.0, 0.0
    a = (np.sqrt(A * B / lam) - B) / C
    return float(a), float((np.sqrt(A) - np.sqrt(lam * B)) ** 2 / C)


@dataclass
class Arbitrage:
    start_token: str
    buy_pool: int  # index (0 or 1) of the pool entered first
    amount_in: float
    amount_mid: float  # intermediate token received from the first pool
    amount_out: float
    profit: float  # NET profit in start_token units: gross - flash fee - gas
    price_gap: float  # relative gap between the two pools' spot prices
    gross_profit: float = 0.0  # amount_out - amount_in (after swap fees only)
    flash_cost: float = 0.0
    gas_cost: float = 0.0


def _route(first: Pool, second: Pool, start: str) -> list[Hop]:
    mid = first.other(start)
    r1 = first.reserves(start)
    r2 = second.reserves(mid)
    return [(r1[0], r1[1], first.gamma), (r2[0], r2[1], second.gamma)]


def simulate_route(first: Pool, second: Pool, start: str, a: float) -> float:
    """Profit of trading ``a`` through ``first`` then ``second`` (pools untouched)."""
    mid = first.other(start)
    got = first.quote_out(start, a)
    return second.quote_out(mid, got) - a


def two_pool_arbitrage(p1: Pool, p2: Pool, gas: Mapping[str, float] | None = None,
                       flash_fee: float = 0.0) -> Arbitrage | None:
    """Best round trip between two pools of the same pair, closed form, net of costs.

    ``gas`` maps a token to the gas cost of the transaction expressed in that token
    (missing tokens cost 0); ``flash_fee`` is a proportional fee on the borrowed input.
    Returns None unless the net profit is positive.
    """
    if {p1.token0, p1.token1} != {p2.token0, p2.token1}:
        raise ValueError("pools must trade the same token pair")
    gas = gas or {}
    best, best_profit = None, 0.0
    for i, (first, second) in enumerate([(p1, p2), (p2, p1)]):
        for start in (first.token0, first.token1):
            a, net = optimal_input(*mobius_coeffs(_route(first, second, start)), flash_fee)
            net -= gas.get(start, 0.0)
            if a > 0 and net > best_profit:
                mid = first.quote_out(start, a)
                out = second.quote_out(first.other(start), mid)
                gap = abs(p1.price / p2.price - 1.0)
                best = Arbitrage(start, i, a, mid, out, net, gap, out - a, flash_fee * a, gas.get(start, 0.0))
                best_profit = net
    return best


def breakeven_mispricing(pool: Pool, gas: Mapping[str, float] | None = None, flash_fee: float = 0.0,
                         fee2: float | None = None, hi: float = 0.5) -> float:
    """Smallest relative price gap between ``pool`` and a same-depth twin that pays off.

    The twin has its token1 reserve scaled by (1 + gap) and fee ``fee2`` (default: same
    as ``pool``). Found by bisection on the closed-form net profit.
    """
    twin = lambda g: Pool(pool.token0, pool.token1, pool.reserve0, pool.reserve1 * (1 + g),
                          pool.fee if fee2 is None else fee2)
    paid = lambda g: two_pool_arbitrage(pool, twin(g), gas, flash_fee) is not None
    if not paid(hi):
        return float("nan")
    lo_, hi_ = 0.0, hi
    for _ in range(100):
        mid = (lo_ + hi_) / 2
        lo_, hi_ = (lo_, mid) if paid(mid) else (mid, hi_)
    return hi_


def profit_curve(first: Pool, second: Pool, start: str, amounts) -> np.ndarray:
    """Vectorised profit for each trade size in ``amounts``."""
    A, B, C = mobius_coeffs(_route(first, second, start))
    a = np.asarray(amounts, dtype=float)
    return path_output(a, A, B, C) - a


def brute_force_optimum(first: Pool, second: Pool, start: str, grid: int = 4001) -> tuple[float, float]:
    """Optimum by log-spaced grid search + golden-section refinement of the swap simulation.

    Independent of the closed form: profit is evaluated by actually quoting both swaps.
    """
    scale = first.reserves(start)[0]
    xs = np.concatenate([[0.0], np.geomspace(1e-9 * scale, 1e4 * scale, grid)])
    ys = np.array([simulate_route(first, second, start, a) for a in xs])
    i = int(np.argmax(ys))
    lo_, hi_ = xs[max(i - 1, 0)], xs[min(i + 1, len(xs) - 1)]
    f = lambda a: simulate_route(first, second, start, a)
    phi = (np.sqrt(5) - 1) / 2
    c, d = hi_ - phi * (hi_ - lo_), lo_ + phi * (hi_ - lo_)
    for _ in range(200):
        if f(c) > f(d):
            hi_, d = d, c
            c = hi_ - phi * (hi_ - lo_)
        else:
            lo_, c = c, d
            d = lo_ + phi * (hi_ - lo_)
    a = (lo_ + hi_) / 2
    return float(a), float(f(a))
