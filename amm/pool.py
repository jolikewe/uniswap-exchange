"""Constant-product pool with Uniswap v2 math.

A swap of ``x_in`` of the input token pays the fee on the input:

    amount_out = x_in * gamma * R_out / (R_in + x_in * gamma),   gamma = 1 - fee

The whole ``x_in`` (fee included) is added to the input reserve, so the
invariant k = R_in * R_out never decreases.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

DEFAULT_FEE = 0.003


def amount_out(x_in: float, r_in: float, r_out: float, fee: float = DEFAULT_FEE) -> float:
    """Output of a swap of ``x_in`` against reserves (r_in, r_out)."""
    g = 1.0 - fee
    return x_in * g * r_out / (r_in + x_in * g)


def amount_in(x_out: float, r_in: float, r_out: float, fee: float = DEFAULT_FEE) -> float:
    """Input required to receive exactly ``x_out`` (inverse of :func:`amount_out`)."""
    if not 0 <= x_out < r_out:
        raise ValueError("x_out must be in [0, r_out)")
    g = 1.0 - fee
    return r_in * x_out / (g * (r_out - x_out))


@dataclass
class Pool:
    """Two-token constant-product pool. ``price`` is token1 per token0."""

    token0: str
    token1: str
    reserve0: float
    reserve1: float
    fee: float = DEFAULT_FEE

    @property
    def gamma(self) -> float:
        return 1.0 - self.fee

    @property
    def k(self) -> float:
        return self.reserve0 * self.reserve1

    @property
    def price(self) -> float:
        """Spot price of token0 expressed in token1."""
        return self.reserve1 / self.reserve0

    def other(self, token: str) -> str:
        if token == self.token0:
            return self.token1
        if token == self.token1:
            return self.token0
        raise KeyError(f"{token} not in pool {self.token0}/{self.token1}")

    def reserves(self, token_in: str) -> tuple[float, float]:
        """(R_in, R_out) when ``token_in`` is paid into the pool."""
        self.other(token_in)
        if token_in == self.token0:
            return self.reserve0, self.reserve1
        return self.reserve1, self.reserve0

    def rate(self, token_in: str) -> float:
        """Marginal exchange rate (out per in) for an infinitesimal trade, fee included."""
        r_in, r_out = self.reserves(token_in)
        return self.gamma * r_out / r_in

    def quote_out(self, token_in: str, x_in: float) -> float:
        r_in, r_out = self.reserves(token_in)
        return amount_out(x_in, r_in, r_out, self.fee)

    def quote_in(self, token_out: str, x_out: float) -> float:
        r_out, r_in = self.reserves(token_out)
        return amount_in(x_out, r_in, r_out, self.fee)

    def swap(self, token_in: str, x_in: float) -> float:
        """Execute a swap in place and return the amount received."""
        out = self.quote_out(token_in, x_in)
        if token_in == self.token0:
            self.reserve0 += x_in
            self.reserve1 -= out
        else:
            self.reserve1 += x_in
            self.reserve0 -= out
        return out

    def copy(self) -> "Pool":
        return replace(self)
