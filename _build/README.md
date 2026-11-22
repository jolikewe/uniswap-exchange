# Page build scripts

The page is assembled from `src/` (template, stylesheet, `core.js` = JS port of the Python package, `ui.js`).

```bash
git clone https://github.com/jolikewe/uniswap-exchange.git ../../uniswap-exchange-main   # the main branch, next to this checkout
python3 make_fixtures.py                    # Python reference outputs -> fixtures.json
python3 build_page.py                       # src/ -> ../index.html
node verify_amm.js ../../uniswap-exchange-main/uniswap_arbitrage.ipynb   # JS port vs Python, notebook numbers
```

`verify_amm.js` compares the deterministic functions (swaps, closed-form arbitrage with gas and flash fee, break-even gap, Bellman-Ford cycles, IL, arbitrage step, v3, LP simulation on a shared normal matrix) to 1e-9 relative, and the seeded Monte Carlo statistically against NumPy.
