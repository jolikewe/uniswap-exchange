"""Multi-pool cycle arbitrage: Bellman-Ford detection and closed-form sizing.

Tokens are nodes; every pool gives two directed edges with weight
-log(marginal rate) = -log(gamma * R_out / R_in). A cycle whose weights sum to a
negative number multiplies money by more than 1 at infinitesimal size, i.e. it
is an arbitrage. Sizing then uses the Moebius composition from ``arbitrage``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .arbitrage import mobius_coeffs, optimal_input
from .pool import Pool

Edge = tuple[int, str, str]  # (pool index, token_in, token_out)


def build_edges(pools: Sequence[Pool]) -> list[Edge]:
    edges: list[Edge] = []
    for i, p in enumerate(pools):
        edges.append((i, p.token0, p.token1))
        edges.append((i, p.token1, p.token0))
    return edges


def edge_weight(pools: Sequence[Pool], e: Edge) -> float:
    return -math.log(pools[e[0]].rate(e[1]))


def find_negative_cycle(pools: Sequence[Pool], tol: float = 1e-12) -> list[Edge] | None:
    """Bellman-Ford from a virtual source; returns one negative cycle or None."""
    edges = build_edges(pools)
    tokens = sorted({t for p in pools for t in (p.token0, p.token1)})
    dist = {t: 0.0 for t in tokens}
    pred: dict[str, Edge | None] = {t: None for t in tokens}
    last = None
    for _ in range(len(tokens)):
        last = None
        for e in edges:
            w = edge_weight(pools, e)
            if dist[e[1]] + w < dist[e[2]] - tol:
                dist[e[2]] = dist[e[1]] + w
                pred[e[2]] = e
                last = e[2]
        if last is None:
            return None
    node = last
    for _ in range(len(tokens)):  # walk back into the cycle
        node = pred[node][1]
    cycle, cur = [], node
    while True:
        e = pred[cur]
        cycle.append(e)
        cur = e[1]
        if cur == node:
            break
    cycle.reverse()
    return cycle


def cycle_rate(pools: Sequence[Pool], cycle: Sequence[Edge]) -> float:
    """Product of marginal rates around the cycle (>1 means profitable)."""
    return math.prod(pools[i].rate(t) for i, t, _ in cycle)


@dataclass
class CycleTrade:
    cycle: list[Edge]
    start_token: str
    amount_in: float
    amount_out: float
    profit: float  # NET of flash fee and gas, in start_token units
    rate: float  # marginal round-trip multiplier at size 0
    gross_profit: float = 0.0  # after swap fees only
    flash_cost: float = 0.0
    gas_cost: float = 0.0


def rotate_cycle(cycle: Sequence[Edge], start_token: str) -> list[Edge]:
    """Rotate a cycle so that it begins (and ends) at ``start_token``."""
    for k, e in enumerate(cycle):
        if e[1] == start_token:
            return list(cycle[k:]) + list(cycle[:k])
    raise KeyError(start_token)


def size_cycle(pools: Sequence[Pool], cycle: Sequence[Edge], start_token: str | None = None,
               gas: Mapping[str, float] | None = None, flash_fee: float = 0.0) -> CycleTrade:
    """Closed-form optimal input for a cycle that uses each pool at most once.

    ``start_token`` picks which token the trade starts (and the profit is paid) in.
    ``gas`` maps token -> gas cost in that token; ``flash_fee`` is proportional on the input.
    ``profit`` is net of both (it may be <= 0, in which case the trade is not worth sending).
    """
    if start_token is not None:
        cycle = rotate_cycle(cycle, start_token)
    hops = []
    for i, t, _ in cycle:
        r_in, r_out = pools[i].reserves(t)
        hops.append((r_in, r_out, pools[i].gamma))
    A, B, C = mobius_coeffs(hops)
    a, net = optimal_input(A, B, C, flash_fee)
    g = (gas or {}).get(cycle[0][1], 0.0)
    gross = A * a / (B + C * a) - a if a > 0 else 0.0
    return CycleTrade(list(cycle), cycle[0][1], a, a + gross, net - g if a > 0 else 0.0,
                      cycle_rate(pools, cycle), gross, flash_fee * a, g if a > 0 else 0.0)


def execute_cycle(pools: Sequence[Pool], trade: CycleTrade) -> float:
    """Swap through the cycle on ``pools`` in place; returns final amount."""
    amt = trade.amount_in
    for i, t, _ in trade.cycle:
        amt = pools[i].swap(t, amt)
    return amt


def simple_cycles(pools: Sequence[Pool], max_len: int = 4) -> list[list[Edge]]:
    """All simple token cycles (no token repeated) up to ``max_len`` hops, one per rotation."""
    edges = build_edges(pools)
    found: dict[tuple, list[Edge]] = {}

    def dfs(start: str, path: list[Edge], visited: set[str]) -> None:
        here = path[-1][2] if path else start
        for e in edges:
            if e[1] != here:
                continue
            if e[2] == start and path:
                cyc = path + [e]
                key = min(tuple((c[0], c[1]) for c in cyc[k:] + cyc[:k]) for k in range(len(cyc)))
                found.setdefault(key, cyc)
            elif e[2] not in visited and len(path) + 1 < max_len:
                dfs(start, path + [e], visited | {e[2]})

    for t in sorted({p.token0 for p in pools} | {p.token1 for p in pools}):
        dfs(t, [], {t})
    return list(found.values())


def best_cycle(pools: Sequence[Pool], max_len: int = 4) -> CycleTrade | None:
    """Exhaustive reference: the profitable simple cycle with the highest marginal rate."""
    best = None
    for cyc in simple_cycles(pools, max_len):
        if len({e[0] for e in cyc}) < len(cyc):
            continue  # reusing a pool within one cycle is not a valid single-shot route
        r = cycle_rate(pools, cyc)
        if r > 1 and (best is None or r > best[0]):
            best = (r, cyc)
    return size_cycle(pools, best[1]) if best else None


def arbitrage_until_flat(pools: Sequence[Pool], max_iter: int = 100, min_profit: float = 1e-12,
                         gas: Mapping[str, float] | None = None, flash_fee: float = 0.0):
    """Repeatedly detect (Bellman-Ford), size and execute until no cycle pays after costs.

    Works on copies; returns (trades, final_pools).
    """
    work = [p.copy() for p in pools]
    trades: list[CycleTrade] = []
    for _ in range(max_iter):
        cyc = find_negative_cycle(work)
        if cyc is None or len({e[0] for e in cyc}) < len(cyc):
            break
        trade = size_cycle(work, cyc, gas=gas, flash_fee=flash_fee)
        if trade.profit <= min_profit:
            break
        execute_cycle(work, trade)
        trades.append(trade)
    return trades, work
