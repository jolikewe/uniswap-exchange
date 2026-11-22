"""The original notebook's stored numbers must still be reproduced."""
import json
import pathlib

import pytest

from amm.legacy import NotebookPool, calculate_arbitrage

NB = pathlib.Path(__file__).resolve().parents[1] / "uniswap_arbitrage.ipynb"


@pytest.fixture(scope="module")
def stored_output():
    nb = json.loads(NB.read_text())
    return "\n".join("".join(o.get("text", [])) for c in nb["cells"] if c["cell_type"] == "code"
                     for o in c.get("outputs", []))


def test_headline_arbitrage_numbers(stored_output):
    a, b = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 5800)
    required, profit, name = calculate_arbitrage(a, b, 10)
    assert name == "B"
    assert round(required, 6) == 29.233166
    assert round(profit, 6) == 0.035127
    assert "Buy 29.233166 ETH from Pool B" in stored_output
    assert "Total profit: $0.035127" in stored_output


def test_swap_cases_and_k(stored_output):
    a, b = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 6000)
    assert a.k == 480000 and b.k == 12000000
    a.swap(input_dai=100)
    assert (round(a.dai, 6), round(a.eth, 6), round(a.k, 6)) == (500.3, 960.0, 480288.0)
    a.swap(input_eth=200)
    assert (round(a.dai, 6), round(a.eth, 6), round(a.k, 6)) == (414.041379, 1160.6, 480536.424828)
    b.swap(input_eth=50)
    assert (round(b.dai, 6), round(b.eth, 6), round(b.k, 6)) == (1983.471074, 6050.15, 12000297.520661)
    for s in ("k: 480288.0", "k: 480536.424828", "k: 12000297.520661"):
        assert s in stored_output


def test_first_cell_main_numbers(stored_output):
    a = NotebookPool("A", 400, 1200)
    a.swap(input_dai=3)
    assert a.dai == pytest.approx(403.009) and a.eth == pytest.approx(1191.0669975186104)
    assert a.k == pytest.approx(480010.7196029777)


def test_benchmark_first_opportunity(stored_output):
    a, b = NotebookPool("A", 400, 1200), NotebookPool("B", 2000, 5700)
    required, profit, _ = calculate_arbitrage(a, b, 10)
    assert (round(required, 6), round(profit, 6)) == (28.729146, 0.539147)
    b.swap(input_eth=required)
    assert (round(b.dai, 6), round(b.eth, 6), round(b.k, 6)) == (1989.97015, 5728.815333, 11400171.510427)
    assert "Buy 28.729146 ETH from Pool B" in stored_output
