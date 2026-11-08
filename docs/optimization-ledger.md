# Optimization ledger

Where we chose the simple path over the fast one. Add a row when you do;
remove it when you fix it.

| Where | What it costs | Fix when |
|---|---|---|
| "Show the math" (`components/calcTrace/*Math.jsx`) | While open, the pass is re-run on every parent render, because the plotted runs, rows and vehicle lists are new arrays each render. One correction, one table row, one vehicle's bars, or one vehicle's three simulated weeks; PerformanceMath also re-runs the chart's entries untraced to list what has bars. Nothing while closed | It lags on a hover |
| `starterSetIds` (utils/setupWizard.js) | resolves specs (`specProvenance`) for every complete vehicle on each starter-set pick in the setup wizard | the fleet passes a few hundred vehicles, or the wizard ships and the pick feels slow |
