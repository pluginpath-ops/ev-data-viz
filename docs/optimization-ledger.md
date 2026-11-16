# Optimization ledger

Where we chose the simple path over the fast one. Add a row when you do;
remove it when you fix it.

| Where | What it costs | Fix when |
|---|---|---|
| "Show the math" (`components/calcTrace/*Math.jsx`) | While open, the pass is re-run on every parent render, because the plotted runs, rows and vehicle lists are new arrays each render. One correction, one table row, one vehicle's bars, or one vehicle's three simulated weeks; PerformanceMath also re-runs the chart's entries untraced to list what has bars. Nothing while closed | It lags on a hover |
| `starterSetIds` (utils/setupWizard.js) | resolves specs (`specProvenance`) for every complete vehicle on each starter-set pick in the setup wizard | the fleet passes a few hundred vehicles, or the wizard ships and the pick feels slow |
| Startup EPA read (`EPA_STARTUP_FIELDS`, DataService) | Still brings every certification and its Guide row, ~60% of the EPA bytes left after #501. The Guide row's descriptive columns (division, carline, drive_desc, model_type_desc…) are read only by the EPA views, so they could move to `getEpaDetail`; the overlay columns cannot | The first load is still slow, or the Guide row grows
| Trip Optimizer leg grid (`OPT_LEG_MI`) | 60–500 mi is 45 stops, twice the old 21, so about 2,500 simulations a vehicle; cells past one charge's reach are null but still run | Opening the optimizer lags, or search stops at the first null leg |
