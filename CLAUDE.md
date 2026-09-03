# Project Guidelines

## Architecture & Code Style

### Modularity and Reusability
Strive for modular, reusable components. When a piece of UI or logic is used in more than one place — or is likely to be reused in the future — extract it into its own component file rather than duplicating it inline.

**Example:** `EditVehicleForm` was extracted from `VehiclesView` into `src/components/EditVehicleForm.jsx` so it could be shared with `RunsView` without duplication.

Prefer:
- One component per file for anything beyond a trivial helper
- Module-level (not inline) component definitions to avoid React remounting on every render
- Shared hooks in `src/hooks/`, shared utilities in `src/utils/`

### CSS
- Use semantic class names defined in `src/index.css` via Tailwind's `@apply` directive
- Class names should describe *what* an element is, not *how* it looks (e.g. `.vehicle-grid`, `.modal-overlay`)

**Tokenise appearance; keep Tailwind for layout.** The line is not "Tailwind
bad" — a one-off `flex items-center gap-2` is fine inline and extracting it
would buy nothing. The rule is about *appearance that repeats*:

- **Colour and size never go inline.** Colours come from tokens, sizes derive
  from `--fs-body` through `--fs-step`. A raw `bg-blue-50` or `text-[11px]` is
  outside the theme and outside the scale, wherever it is written.
- **A cluster that describes what something IS wants a name.** When you touch
  markup carrying one, convert it to a semantic class in `src/index.css` rather
  than restyling it in place. Reuse an existing class before inventing one.

Why it matters concretely: the Range & Efficiency run rows drew seven badges in
seven different inline clusters (`bg-amber-50`/`bg-orange-50`/`bg-cyan-50`/
`bg-green-50`/`bg-blue-50`) — a rainbow where no hue meant anything. When the
re-skin re-valued the tokens, every semantic class moved for free and every
inline cluster kept painting the old palette.

- **`npm run drift` is the ledger of what is left** — 699 things across ten
  probes, each with a count, what the number means, and where the drift is
  supposed to go. `npm run drift <probe>` lists the sites. It is asserted in
  `src/__tests__/drift.test.js` and **fails on a fall as well as a rise**:
  clearing some is not silently absorbed, you lower the count in
  `scripts/driftProbes.js`. A rise needs a reason in the PR.
- Two ratchets predate it and stay in their own suites: `KNOWN_OFFENDERS`
  (`contrast.test.js`, light surfaces with no dark counterpart) and the
  dark-override cap (`playground.test.js`). Lower those the same way.
- Never add a `[data-theme="dark"] .foo` rule — it cannot follow a themed
  subtree.

### Naming

**One name per thing — `docs/vocabulary.md` is the list.** Read it before
naming anything new, and use the standard term it gives rather than inventing a
house one.

It exists because three words drifted: "rail" meant the chart sidebar, the
sub-nav AND a card's coloured left edge; "chrome" meant both a category and one
specific region. A word with no fixed referent attracts whatever needs naming
next. The short version — **chrome** is the category (furniture, not data),
**header** is the pinned block at the top, **sidebar** is the chart's control
column, **accent border** is a card's coloured left edge, **chips** are the
selected-vehicle pills.

**Naming is worth stopping for.** A class name is the whole value of extracting
one, and a bad name is worse than the cluster it replaced. If the right name
isn't obvious, say so and ask rather than guessing.

### Tech Stack
- React 19 + Vite + Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first, no `tailwind.config.js`)
- Supabase for auth and data

## Git Workflow

Always start a new feature branch from `main` for each distinct feature or fix. Never stack unrelated work on an open branch.

```
git checkout main && git pull
git checkout -b feature/my-feature
# ... work ...
gh pr create --base main
```

After a PR merges, pull `main` and delete the local branch before starting the next feature.

## Site Overview

EVBench is a tool for comparing real-world EV charging and range performance across vehicles. It combines raw test data (uploaded from CSV/Tableau exports) with crowd-sourced accuracy signals (votes, flags) and structured vehicle specs.

### Tabs

**Vehicles**
The home view. Shows a card/list grid of all vehicles in the database. Users select one or more vehicles here to drive the Charts and Compare Specs tabs. Admins and contributors can add, edit, reorder, duplicate, and delete vehicles. Each card shows battery size, EPA range, test count, and tags.

**Tests & Data**
Per-vehicle view of charging and range test runs. Each run has metadata (date, tester, speed, temperature, notes) and an attached dataset of time-series data points (`soc`, `time`, `range`, `charge_rate`, `temperature`). Users upload data via CSV or Tableau export. Runs are marked `has_charging` or `has_range` to drive chart routing. One run per vehicle can be marked `is_default` as the fallback charging source for the Charge Compare chart.

**Charts**
Visualizations for selected vehicles. Three sub-tabs:
- *Charging* — interactive line/scatter chart of any two axes (SoC, time, charge rate, range, temperature, C-rate, etc.) across selected runs. Supports dual Y-axis, race mode (normalize all runs to a common SoC start), and axis scale overrides.
- *Range & Efficiency* — bar charts comparing range and efficiency across vehicles/runs (EPA miles, tested miles, Wh/mi, mi/kWh). Bars have inside-bar pill badges showing key metadata.
- *Charge Compare* — bar charts comparing charging performance: (1) range added in X minutes from ~Y% SoC, and (2) time to add M miles from ~Y% SoC. Uses linear interpolation on the charging data. Bars have inside-bar pill badges.

All chart tabs support a **"Open Chart in New Window"** button that opens a fullscreen presentation-mode window synced live to the main tab via `BroadcastChannel`.

**Compare Specs**
Side-by-side structured spec comparison for selected vehicles. Specs are stored as a JSONB column (`specs`) on the vehicle record, keyed by a schema defined in `src/utils/vehicleSpecSchema.js`. Custom (free-form) fields are also supported. Community members can vouch for accuracy or flag suspect values. Admins can remove flags. Specs can be exported as JSON (including blank fields as a template) and imported back.

**Admin** *(admin role only)*
User management — view registered users, assign roles (`admin`, `contributor`, `viewer`).

## Linting

`npm run lint` (ESLint 9, flat config in `eslint.config.js`). **Zero errors is the
bar**; warnings are a visible backlog.

It exists for one bug in particular: a helper used in JSX without being imported
is a runtime `ReferenceError` that no build step catches, because Vite
transpiles rather than resolves. That blanked the app three times in one day.
`no-undef` catches it before the page renders.

The React Compiler rules shipped with eslint-plugin-react-hooks v6 are set to
`warn`, not `off` — 33 places would need a refactor, and a lint that fails on
arrival is one nobody runs. `react-hooks/set-state-in-effect` in particular is
worth working through; it is the shape of a bug this project has already hit.

## Testing

`npm test` (vitest, `npm run test:watch` to iterate). Suites live in
`src/utils/__tests__/` for pure modules, plus `src/__tests__/wiring.test.js`.

The wiring suite is the unusual one and worth keeping. Every other test checks
that a function returns the right answer; none of them can tell you **nobody
calls it**. That is the failure mode this project keeps hitting — three defects
found by hand in one week were all "built, unit-tested, never connected". The
wiring suite reads source text to assert the seams hold: that a note written to
every run is read somewhere, that every chart showing a test speed also marks a
mixed cycle, that a tunable constant reaches the Admin knobs.

### The drift ledger

`npm run drift` prints what the codebase still paints outside the theme —
palette utilities by property, `text-[Npx]` literals, raw hex and rgb, canvas
font shorthands, `@apply` lines reaching for a palette colour, off-scale
`font-size`. `npm run drift
<probe>` lists the sites behind one number.

The probes and their counts live together in `scripts/driftProbes.js`, so
adding a probe, recording its count and writing down why a match is legitimate
are one edit. `drift.test.js` asserts each count with `toBe` — **a fall fails
too**, because a cap absorbs cleanups silently and six months later nobody can
tell whether the backlog shrank or the probe broke.

Two probes were deliberately NOT built, and the reasoning is the useful part: a
ledger that counts correct code teaches people to ignore it. Literal colours in
inline `style={{…}}` measured at zero — all 91 blocks hold runtime values like
`backgroundColor: run.color`, which can never be a class. Three-digit hex was
half issue references in comments (`#221`). Anything genuinely un-tokenisable
goes in `EXEMPT` with a reason, and a test fails when an exemption stops
matching anything.

When adding a utility for the UI, expect the wiring suite to fail until
something consumes it. If it is deliberately unused, add it to `ALLOWED_UNUSED`
with the reason — an entry there is a decision on record, not an oversight.
