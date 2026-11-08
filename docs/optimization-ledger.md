# Optimization ledger

Where we chose the simple path over the fast one. Add a row when you do;
remove it when you fix it.

| Where | What it costs | Fix when |
|---|---|---|
| "Show the math" (`components/calcTrace/RangeMath.jsx`, `CostMath.jsx`) | While open, the pass is re-run on every parent render, because the plotted runs and the vehicle list are new arrays each render. One correction or one vehicle's three simulated weeks; nothing while closed | It lags on a hover, or the panel leaves prototype |
