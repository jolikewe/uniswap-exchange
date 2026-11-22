"""Uniswap v3 concentrated-liquidity position maths (single range, fee-free value)."""
from __future__ import annotations

import numpy as np


def amounts(L: float, p, pa: float, pb: float):
    """Token0 and token1 held by liquidity L in range [pa, pb] at price p (token1 per token0)."""
    p = np.asarray(p, dtype=float)
    sa, sb = np.sqrt(pa), np.sqrt(pb)
    sp = np.clip(np.sqrt(p), sa, sb)
    return L * (1.0 / sp - 1.0 / sb), L * (sp - sa)


def liquidity_from_value(v0: float, p0: float, pa: float, pb: float) -> float:
    """Liquidity bought by value v0 (in token1) deposited at price p0 inside the range."""
    x1, y1 = amounts(1.0, p0, pa, pb)
    return v0 / (x1 * p0 + y1)


def position_value(L: float, p, pa: float, pb: float):
    x, y = amounts(L, p, pa, pb)
    return x * np.asarray(p, dtype=float) + y


def il_versus_hodl(p, p0: float, pa: float, pb: float):
    """Position value / value of just holding the initial tokens, minus 1."""
    L = liquidity_from_value(1.0, p0, pa, pb)
    x0, y0 = amounts(L, p0, pa, pb)
    p = np.asarray(p, dtype=float)
    return position_value(L, p, pa, pb) / (x0 * p + y0) - 1.0


def concentration_factor(p0: float, pa: float, pb: float) -> float:
    """Liquidity per unit of capital relative to a full-range v2 position (> 1 when concentrated)."""
    full_range = 1.0 / (2.0 * np.sqrt(p0))
    return liquidity_from_value(1.0, p0, pa, pb) / full_range
