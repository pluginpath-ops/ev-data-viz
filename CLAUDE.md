# Project Guidelines

## How to Work

Think like a principal engineer.

- **Survey before you start.** Look around the site for related appearance
  and behavior, then:
  1. **Reuse** what already exists — a component, class, hook or pattern.
  2. **Expand scope where it fits** — if the same fix belongs in three places,
     say so and propose doing all three.
  3. **Ask about conflicts** — if the request clashes with how the site
     already works, or with an earlier decision, ask before building.
- **Ask why, not just what.** Find the need behind the request and where the
  product is likely to go. Build for that, not only the literal ask. If the ask
  and the need disagree, say so.
- **Look for knock-on effects.** What else reads this data, shares this
  component, or assumes this behavior? Check before you change it, and say what
  you found.
- **Delete ruthlessly.** Old, dead, confusing, or slow code goes — in the same
  change that makes it dead. Don't leave a second path "just in case".
- **Don't optimize early, but write down where you didn't.** When you take the
  simple path over the fast one, add a line to `docs/optimization-ledger.md`:
  where, what the cost is, and what would make it worth fixing.
- **Design for** generality, modularity, fast round trips (fewer, smaller
  queries; no waterfalls), and consistent data (one source of truth; writes
  that can't leave things half-done).
- **Have taste.** Make the call and say why. Clear and responsive for the user
  beats clever.
- **Fewer words, simpler words** — in UI text, comments, commits, and replies.

## Site Overview

EVBench compares real-world EV charging, range and performance across
vehicles. It combines tested data (CSV/Tableau uploads, published results),
EPA data (the Fuel Economy Guide and certification test sheets) and structured
vehicle specs.

### Tabs

The nav is defined in `src/components/shell/AppNav.jsx`; chart tabs and their
sub-tabs come from `src/constants/chartNav.js`. `docs/vocabulary.md` names
every tab, sub-tab and section — use its names.

- **Home** — a featured comparison a curator chose, every chart drawn at once.
  The landing for a bare address.
- **Vehicles & Specs** — the cards and list (*Summary*), plus the vehicle table
  and the spec chart (*Specifications & Data*). Select vehicles here or with
  ＋ Add from any tab; the selection drives the chart tabs.
  - **The vehicle's page** (`?tab=runs&vid=…`, "Tests & Data") — one vehicle's
    tests, EPA configurations and performance. Not a tab; opened from a card,
    row or chip, and shown in the header as the opened vehicle.
- **Performance** — acceleration Compare and Acceleration Curve.
- **Charging & Range** (key `efficiency`) — Charging Curves, Range &
  Efficiency, Charge Stop, Road Trip, Trip Optimizer.
- **EPA** — every EV EPA has rated: Browse, Label Statistics, Certification
  Statistics, and Modeled Efficiency (all EVs, or the selected vehicles with
  their tests).
- **Reference** — Explainers (`src/explainers/`, own CLAUDE.md) and Platforms.
- **Admin** *(admin only)* — roles, EPA and Guide imports, Data Checks,
  Published Results, brands/platforms/tags, Site Events, Model Constants
  (`src/constants/` knobs), Interface Settings, and the design Playground.

Every chart has a pop-out window synced over `BroadcastChannel`, a URL that
reopens it as left (`utils/chartUrlState.js`), and a help bubble. **Mode keys
in `chartNav.js` are frozen** — the pop-out, the help-bubble rows and shared
links all depend on them. Rename labels, not keys.

### Data model, in brief

- **Vehicles** carry `specs` (JSONB, schema in `utils/vehicleSpecSchema.js`),
  a color, and a lineage: variants inherit from a source by pointer
  (`utils/vehicleInheritance.js`), and charging tests come down the lineage.
- **Runs** (tests) have one `kind`, `'charging'` or `'range'`, plus time-series
  points. A vehicle may have one `is_default` run per kind
  (`utils/rangeSource.js`).
- **Composites** — a stored composite charging curve, and a read-time composite
  range corrected to the reader's correction target.
- Migrations live in `supabase/migrations/`, numbered.

### Tech Stack
- React 19 + Vite + Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first, no `tailwind.config.js`)
- Supabase for auth and data (roles: `admin`, `contributor`, `viewer`)

## Architecture & Code Style

### Modularity and Reusability
Extract UI or logic used in more than one place — or likely to be — into its
own file rather than duplicating it.

- One component per file for anything beyond a trivial helper
- Module-level (not inline) component definitions, so React doesn't remount
- Shared hooks in `src/hooks/`, utilities in `src/utils/`, constants in
  `src/constants/`
- Number fields use `NumberInput`

### CSS

**Tokenize appearance; keep Tailwind for layout.** A one-off
`flex items-center gap-2` inline is fine. Appearance is not:

- **Color and size never go inline.** Colors come from tokens; sizes derive
  from `--fs-body` through `--fs-step`. No raw `bg-blue-50` or `text-[11px]`.
- **A cluster that describes what something IS wants a name.** Give it a
  semantic class in `src/index.css` (via `@apply`) named for what it is, not
  how it looks (`.vehicle-grid`, not `.blue-box`). Reuse an existing class
  first. When you touch markup carrying such a cluster, convert it.
- Never add a `[data-theme="dark"] .foo` rule — it cannot follow a themed
  subtree.

Three ratchets track what is left. Each fails on a fall as well as a rise, so
when you clear something, lower the count; a rise needs a reason in the PR.

- `npm run drift` — appearance outside the theme, by probe
  (`scripts/driftProbes.js`). `npm run drift <probe>` lists the sites.
  Genuinely un-tokenizable code goes in `EXEMPT` with a reason.
- `KNOWN_OFFENDERS` in `contrast.test.js` — light surfaces with no dark
  counterpart.
- The dark-override cap in `playground.test.js`.

### Naming

**One name per thing — `docs/vocabulary.md` is the list.** Read it before
naming anything, and use its term rather than inventing one.
`docs/design-tokens.md` does the same for color, `docs/typography.md` for type.
Common ones: **chrome** is the category (furniture, not data), **header** is
the pinned block at the top, **sidebar** is the chart's control column,
**accent border** is a card's colored left edge, **chips** are the
selected-vehicle pills.

**Naming is worth stopping for.** If the right name isn't obvious, ask rather
than guess. A name still being argued over goes in **Open names**, not into
the code. American spelling.

## Git Workflow

One branch from `main` per feature or fix; never stack unrelated work.

```
git checkout main && git pull
git checkout -b feature/my-feature
# ... work ...
gh pr create --base main
```

After a PR merges, pull `main` and delete the local branch.

**Stacked PRs are for one plan's dependent layers only.** Use `gh stack` and
follow `.claude/skills/stacked-prs/SKILL.md`.

### The docs check, and the pledge

**Before every commit, and again on the PR title and description**, check what
you wrote against `docs/vocabulary.md`, and `docs/design-tokens.md` /
`docs/typography.md` for anything naming a color or size.

`npm run vocab` checks the Retired words on the lines you added:

```
npm run vocab                                    # changed lines vs main
npm run vocab -- --staged                        # just what is staged
npm run vocab -- --text "$(gh pr view --json body -q .body)"
```

It can't catch the Retired words that are right in some places — "chrome" for
the header, "Runs" in UI text, "pinning", a bare "band", "Hidden" for a test,
"test group" for the EPA test vehicle record. Only a reader can.

**The pledge: one line in the commit or PR body saying what you checked:**

> Vocabulary: checked against docs/vocabulary.md — "series color" and "the
> ramp" are its terms. `npm run vocab` clean. New name `plottedIds` has no
> entry; it is not user-facing so it does not need one.

If you name something the vocabulary lacks, add it. If a comment you touch
contradicts the schema or a migration, fix it in the same commit — a stale
comment is worse than none.

## Linting

`npm run lint` (ESLint 9, `eslint.config.js`). **Zero errors**; warnings are
backlog. `no-undef` matters most: a helper used in JSX without an import is a
runtime crash Vite won't catch. The React Compiler rules are `warn` —
`react-hooks/set-state-in-effect` is worth working down.

## Testing

`npm test` (vitest; `npm run test:watch` to iterate). Pure-module suites live in
`src/utils/__tests__/`; app-wide guards in `src/__tests__/`.

**The wiring suite** (`src/__tests__/wiring.test.js`) checks that code is
actually connected — that what is written is read, and what is built is
called. Expect it to fail on a new utility until something uses it. If it is
deliberately unused, add it to `ALLOWED_UNUSED` with the reason.

### Database and privileged work: local mirror first

Anything that changes the database (migration, backfill, new write path) or
needs a privileged role is tested against the newest backup first:
`scripts/localdb.sh up`, `migrate` the migrations under test, then `serve`
(PostgREST + local sign-in, writes `.env.local`). Sign in as a seeded user;
real RLS applies. Leave it running between sessions unless told otherwise.
Details in [scripts/README.md](scripts/README.md).
