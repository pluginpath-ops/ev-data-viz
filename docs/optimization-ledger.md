# Optimization ledger

Where we chose the simple path over the fast one. Add a row when you do;
remove it when you fix it.

| Where | What it costs | Fix when |
|---|---|---|
| `starterSetIds` (utils/setupWizard.js) | resolves specs (`specProvenance`) for every complete vehicle on each starter-set pick in the setup wizard | the fleet passes a few hundred vehicles, or the wizard ships and the pick feels slow |
