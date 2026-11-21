# Uniswap Pool Arbitrage

Python simulation of two Uniswap constant-product pools and the arbitrage opportunity between them.

**[▶ Live demo](https://jolikewe.github.io/uniswap-exchange/)**: drag trades along the x·y=k curve and replay the arbitrage.

![Python](https://img.shields.io/badge/python-3-blue)

## Overview

Uniswap is a decentralized exchange on Ethereum. Each pair is a liquidity pool holding reserves of two ERC-20 tokens (here ETH and DAI) and acts as an automated market maker: trades must preserve the constant product `x * y = k`, so larger trades relative to the reserves execute at worse rates. A 0.3% fee is added to the reserves on every trade, which slowly increases `k`.

The notebook models two pools, A and B. Because the relative price of the assets only changes through trading, a price gap between the pools is an arbitrage opportunity. The notebook implements:

1. `PoolStatus`: pool state with `getPrice`, `add`, `remove`, `getPriceInput`, `getPriceOutput`, `swap` and `check` (print the pool status). The first version uses the spot price for `getPriceInput`.
2. `PoolStatus` v2: an `async` version whose `getPriceInput` uses the constant-product formula and includes the 0.3% fee. `calculate_arbitrage()` compares the two pools, buys the requested amount of DAI from the pool with the lower ETH-per-DAI price, sells it in the other pool and returns `(required_eth, profit, pool_name)` if the profit is positive, otherwise `None`. `opportunityStatus()` prints the result.
3. Test cases that simulate swaps and show `k` increasing slightly after each trade.
4. A benchmark that repeatedly checks for an opportunity and executes the trade until the opportunity disappears.

## Results

Output stored in the notebook, with Pool A at 400 DAI / 1200 ETH (price 3.0) and Pool B at 2000 DAI / 5800 ETH (price 2.9), asking for 10 DAI:

| Quantity | Value |
| --- | --- |
| Pool to buy from | B (lower price) |
| ETH required | 29.233166 |
| Profit (ETH) | 0.035127 |

Swap test cases on Pool A (400 DAI / 1200 ETH, k = 480000):

| Swap | Pool A after the swap | k |
| --- | --- | --- |
| 100 DAI in | 500.3 DAI / 960.0 ETH | 480288.0 |
| then 200 ETH in | 414.041379 DAI / 1160.6 ETH | 480536.424828 |

The benchmark (Pool B at 2000 DAI / 5700 ETH) found an opportunity twice, executed the two trades and then reported no remaining opportunity; the stored run took about 0.002 seconds.

## Repository structure

```
.
├── uniswap_arbitrage.ipynb   # pool model, arbitrage calculation, test cases, benchmark
├── requirements.txt
└── README.md
```

## Getting started

Prerequisites: Python 3 and Jupyter. The code uses only the standard library (`math`, `asyncio`, `time`).

```bash
pip install -r requirements.txt
jupyter notebook uniswap_arbitrage.ipynb
```

Run the cells in order; later cells reuse the `PoolStatus` class defined in the v2 cell and rely on top-level `await`, which works in Jupyter but not in a plain Python script.

## Notes

- The first `PoolStatus` class in the notebook is a simple version; the arbitrage code uses the async version defined later.
- In the benchmark cell, the second check is labelled "20 DAI" in the printed output but is called with `output_dai=10`.
- The printed profit is labelled with a `$` sign but is computed in ETH.
