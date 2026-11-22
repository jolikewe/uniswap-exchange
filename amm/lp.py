"""Liquidity-provider analytics: impermanent loss, LP vs HODL, LVR Monte Carlo.

Conventions: token1 is the numeraire, ``S`` is the external price of token0 in
token1, and the pool starts at S0 with half of its value in each token.

Closed forms (fee-free constant product, r = S_T / S_0):

    pool value / HODL value = 2*sqrt(r) / (1 + r)          IL(r) = that - 1
    pool value = V0 * sqrt(r)                              HODL value = V0*(1 + r)/2

For GBM with zero drift, E[pool - HODL] = -V0*(1 - exp(-sigma^2*T/8)), which is
also the expected loss-versus-rebalancing (LVR).
"""
from __future__ import annotations

import numpy as np

DAYS_PER_YEAR = 365.0


def impermanent_loss(r):
    """Fractional IL versus HODL for price ratio r = S_T / S_0 (fee-free, v2)."""
    r = np.asarray(r, dtype=float)
    return 2.0 * np.sqrt(r) / (1.0 + r) - 1.0


def lp_value(r, v0: float = 1.0):
    return v0 * np.sqrt(np.asarray(r, dtype=float))


def hodl_value(r, v0: float = 1.0):
    return v0 * (1.0 + np.asarray(r, dtype=float)) / 2.0


def expected_lvr_fraction(sigma: float, years: float) -> float:
    """E[LVR]/V0 = 1 - exp(-sigma^2 T / 8) for a fee-free pool and zero-drift GBM."""
    return float(1.0 - np.exp(-sigma**2 * years / 8.0))


def break_even_turnover(sigma: float, fee: float) -> float:
    """Daily volume / TVL at which fee income f*turnover equals the LVR rate sigma^2/8.

    First-order rule of thumb (it ignores that fees also shrink arbitrage flow).
    """
    return sigma**2 / 8.0 / DAYS_PER_YEAR / fee


def arbitrage_to_price(x, y, S, fee: float, gas: float = 0.0):
    """Reserves after an arbitrageur moves the pool as far as the fee allows.

    Closed form. The pool is left with marginal buy price p'/gamma = S (if token0
    was too cheap) or marginal sell price gamma*p' = S (if too dear), so the pool
    price ends inside the no-arbitrage band [gamma*S, S/gamma]. Works on arrays.
    ``gas`` (token1 units) is a fixed cost per arbitrage transaction: the trade is only
    sent when its profit exceeds it, and the returned profit is net of it.
    Returns (x', y', profit in token1).
    """
    g = 1.0 - fee
    x, y, S = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float), np.asarray(S, float))
    k = x * y
    p = y / x
    buy = p < g * S   # token0 underpriced: pay token1, receive token0
    sell = p > S / g  # token0 overpriced: pay token0, receive token1
    dy = np.where(buy, (np.sqrt(g * k * S) - y) / g, 0.0)
    dx = np.where(sell, (np.sqrt(g * k / S) - x) / g, 0.0)
    x_new = np.where(buy, k / (y + g * dy), np.where(sell, x + dx, x))
    y_new = np.where(buy, y + dy, np.where(sell, k / (x + g * dx), y))
    profit = (x - x_new) * S + (y - y_new)
    if gas > 0.0:
        skip = profit <= gas
        x_new, y_new = np.where(skip, x, x_new), np.where(skip, y, y_new)
        profit = np.where(skip, 0.0, profit - gas)
    return x_new, y_new, profit


def simulate_lp(sigma: float, fee: float = 0.003, turnover: float = 0.0, days: float = 30.0,
                steps_per_day: int = 24, n_paths: int = 1000, seed: int = 0, mu: float = 0.0,
                S0: float = 1.0, V0: float = 1.0, Z: np.ndarray | None = None, gas: float = 0.0) -> dict:
    """Monte Carlo of a full-range v2 LP under GBM with arbitrageurs aligning the pool.

    sigma, mu: annualised. turnover: uninformed daily volume / pool value (their
    trades are assumed price-neutral and only pay the fee, which is kept in a cash
    account). Arbitrage fees are retained in the pool reserves. ``gas`` is the cost of one
    arbitrage transaction in units of V0 (the arbitrageur only trades when profit exceeds it).

    Returns arrays of shape (n_paths, n_steps + 1): S, pool, fees, hodl, plus
    ``net`` = (pool + fees - hodl)/V0, ``il`` = (pool - hodl)/V0 and
    ``lvr`` = (rebalancing portfolio - pool)/V0 and ``arb_profit`` = cumulative arbitrageur
    profit net of gas / V0.
    """
    n = int(round(days * steps_per_day))
    dt_days = 1.0 / steps_per_day
    dt = dt_days / DAYS_PER_YEAR
    if Z is None:
        Z = np.random.default_rng(seed).standard_normal((n_paths, n))
    n_paths = Z.shape[0]
    S = np.empty((n_paths, n + 1)); S[:, 0] = S0
    S[:, 1:] = S0 * np.exp(np.cumsum((mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * Z, axis=1))

    x = np.full(n_paths, V0 / (2 * S0)); y = np.full(n_paths, V0 / 2)
    pool = np.empty_like(S); pool[:, 0] = V0
    fees = np.zeros_like(S)
    w = np.empty_like(S); w[:, 0] = V0
    arb = np.zeros_like(S)
    xs = x.copy()
    for i in range(1, n + 1):
        w[:, i] = w[:, i - 1] + xs * (S[:, i] - S[:, i - 1])
        x, y, prof = arbitrage_to_price(x, y, S[:, i], fee, gas)
        xs = x
        pool[:, i] = x * S[:, i] + y
        arb[:, i] = arb[:, i - 1] + prof
        fees[:, i] = fees[:, i - 1] + fee * turnover * dt_days * pool[:, i]
    hodl = V0 / 2 * (S / S0 + 1.0)
    return {
        "t_days": np.arange(n + 1) * dt_days, "S": S, "pool": pool, "fees": fees, "hodl": hodl,
        "net": (pool + fees - hodl) / V0, "il": (pool - hodl) / V0, "lvr": (w - pool) / V0,
        "arb_profit": arb / V0,
    }


def summarise(res: dict) -> dict:
    """Terminal-time statistics of a :func:`simulate_lp` result."""
    net, il, fees, lvr = (res[k][:, -1] for k in ("net", "il", "fees", "lvr"))
    n = len(net)
    v0 = res["pool"][0, 0]
    q = np.percentile(net, [5, 25, 50, 75, 95])
    return {
        "mean_net": float(net.mean()), "se_net": float(net.std(ddof=1) / np.sqrt(n)),
        "p_lp_beats_hodl": float((net > 0).mean()), "quantiles": q.tolist(),
        "mean_il": float(il.mean()), "mean_fees": float(fees.mean() / v0),
        "mean_lvr": float(lvr.mean()), "se_lvr": float(lvr.std(ddof=1) / np.sqrt(n)),
    }
