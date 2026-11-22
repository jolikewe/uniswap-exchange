"""The pool model of the original notebook (``uniswap_arbitrage.ipynb``).

Kept so the notebook's stored numbers stay reproducible. Its fee convention
differs from Uniswap v2: the output is read off the fee-free curve and a 1.003
surcharge is added on top of the input. Use :class:`amm.pool.Pool` for new work.
"""
from __future__ import annotations

FEE_FACTOR = 1.003


class NotebookPool:
    def __init__(self, name: str, dai: float, eth: float):
        self.name, self.dai, self.eth = name, dai, eth
        self._refresh()

    def _refresh(self) -> None:
        self.k = self.dai * self.eth
        self.price = self.eth / self.dai  # ETH per DAI

    def price_input(self, output_dai: float = 0, output_eth: float = 0) -> float:
        if output_eth:
            return (self.k / (self.eth - output_eth) - self.dai) * FEE_FACTOR
        return (self.k / (self.dai - output_dai) - self.eth) * FEE_FACTOR

    def price_output(self, input_dai: float = 0, input_eth: float = 0) -> float:
        if input_eth:
            return self.dai - self.k / (input_eth + self.eth)
        return self.eth - self.k / (input_dai + self.dai)

    def swap(self, input_dai: float = 0, input_eth: float = 0) -> None:
        if input_eth:
            self.dai -= self.price_output(input_eth=input_eth)
            self.eth += input_eth * FEE_FACTOR
        else:
            self.eth -= self.price_output(input_dai=input_dai)
            self.dai += input_dai * FEE_FACTOR
        self._refresh()


def calculate_arbitrage(pool_a: NotebookPool, pool_b: NotebookPool, output_dai: float):
    """Notebook logic: buy ``output_dai`` in the cheaper pool, sell in the dearer one.

    Returns ``(required_eth, profit_eth, buy_pool_name)`` or ``None``.
    """
    if pool_a.price == pool_b.price:
        return None
    higher, lower = (pool_a, pool_b) if pool_a.price > pool_b.price else (pool_b, pool_a)
    required = lower.price_input(output_dai=output_dai)
    received = higher.price_output(input_dai=output_dai)
    profit = received - required
    return (required, profit, lower.name) if profit > 0 else None
