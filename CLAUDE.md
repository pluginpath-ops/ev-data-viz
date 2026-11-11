# Project Guidelines

## How to Work

Think like a principal engineer: know what must be built carefully for the
future and what should stay simple. Over-generalizing bites as hard as
over-fitting to today's case.

- **Survey before you start.** Look around the site for related appearance
  and behavior, then:
  1. **Reuse** what already exists — a component, class, hook or pattern.
  2. **Think it through.** Does this change how other features should work?
     What follow-on work does it shake out? Say so. This widens the thinking,
     not the build.
  3. **Ask about conflicts** — if the request clashes with how the site
     already works, or with an earlier decision, ask before building.
- **Decide how to build it; ask about intent.** Implementation is your call —
  make it and say why. What the feature is for and where it is going is the
  owner's; ask when it isn't clear.
- **Look for knock-on effects.** What else reads this data, shares this
  component, or assumes this behavior? Check before you change it, and say what
  you found.
- **Delete ruthlessly.** Old, dead, confusing, or slow code goes — in the same
  change that makes it dead. Don't leave a second path "just in case". Code
  kept on purpose (a tripwire, a deferred rename) says so in a comment with a
  revisit date a few months out; past that date, it is a candidate to delete.
- **Don't optimize early, but write down where you didn't.** When you take the
  simple path over the fast one, add a line to `docs/optimization-ledger.md`.
  It is a judgment call, not a checklist — the point is a list of likely
  targets when things get slow.
- **Design for** modularity, fast round trips (fewer, smaller queries; no
  waterfalls), and consistent data (one source of truth; writes that can't
  leave things half-done). Generalize when a second real case appears, not
  before.
- **Clear and responsive for the user beats clever.**
- **Fewer words, simpler words** — in UI text, comments, commits, and replies.

## Site Overview

EVBench compares real-world EV charging, range and performance across
vehicles. It combines tested data (CSV/Tableau uploads, published results),
EPA data (the Fuel Economy Guide and certification test sheets) and structured
vehicle specs.

### Tabs

The nav is `src/components/shell/AppNav.jsx`; chart sub-tabs are
`src/constants/chartNav.js`. `docs/vocabulary.md` has every tab and sub-tab
name — this is only the map.

- **Home** — a curator's featured comparison.
- **Vehicles & Specs** — browse and select vehicles; the vehicle table and spec
  chart. Each vehicle also has its own page (tests, EPA, performance), reached
  from a card or row, not a tab.
- **Performance**, **Charging & Range** — charts of the selected vehicles'
  tests.
- **EPA** — every EV EPA has rated.
- **Reference** — explainers (`src/explainers/`, own CLAUDE.md) and platforms.
- **Admin** — imports, data checks, model constants, site settings.

Every chart has a pop-out window, a link that reopens it as left
(`utils/chartUrlState.js`), and a help bubble. **Mode keys in `chartNav.js`
are frozen** — all three depend on them. Rename labels, not keys.

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
- Why: when tokens change, semantic classes follow; inline clusters keep
  painting the old palette.
- **A cluster that describes what something IS wants a name.** Give it a
  semantic class in `src/index.css` (via `@apply`) named for what it is, not
  how it looks (`.vehicle-grid`, not `.blue-box`). Reuse an existing class
  first. When you touch markup carrying such a cluster, convert it.
- Never add a `[data-theme="dark"] .foo` rule — it cannot follow a themed
  subtree. `playground.test.js` fails on one.

Two ratchets track what is left. Each fails on a fall as well as a rise, so
when you clear something, lower the count; a rise needs a reason in the PR. (A
cap alone would hide cleanups, and nobody could tell progress from a broken
probe.)

- `npm run drift` — appearance outside the theme, by probe
  (`scripts/driftProbes.js`). `npm run drift <probe>` lists the sites.
  Genuinely un-tokenizable code goes in `EXEMPT` with a reason.
- `KNOWN_OFFENDERS` in `contrast.test.js` — light surfaces with no dark
  counterpart.

### Naming

**One name per thing — `docs/vocabulary.md` is the list.** Read it before
naming anything, and use its term rather than inventing one. A word with no
fixed meaning soaks up whatever needs naming next.
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
"test group" for the EPA test vehicle record. Only a reader can — so the
pledge exists to make sure the file actually gets opened.

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
called. Unit tests can't catch code that works but nothing uses, and that is
this project's most common defect. Expect it to fail on a new utility until something uses it. If it is
deliberately unused, add it to `ALLOWED_UNUSED` with the reason.

### Database and privileged work: local mirror first

Anything that changes the database (migration, backfill, new write path) or
needs a privileged role is tested against the newest backup first:
`scripts/localdb.sh up`, `migrate` the migrations under test, then `serve`
(PostgREST + local sign-in, writes `.env.local`). Sign in as a seeded user;
real RLS applies. Leave it running between sessions unless told otherwise.
Details in [scripts/README.md](scripts/README.md).
