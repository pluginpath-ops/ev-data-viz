# Explainers — rules for this folder

Explainers are articles on how something works, with diagrams: Reference ›
Explainers (#355, the plan in `LocalDev/explainers-plan.md`). This folder is
separate from the rest of EVBench on purpose. Work here follows the rules
below; the root `CLAUDE.md` still applies for code style, CSS tokens,
vocabulary and git.

## The boundary

Everything explainer-only lives under `src/explainers/`: pages, content, the
facts ledger, `chargeSim.js`, and explainer-only components. Keep it at most
two levels deep (`src/explainers/<dir>/<file>`), because the lint rule matches
import paths by depth.

`eslint.config.js` enforces two connections and no others:

- **Explainers may import** from EVBench: `utils/platforms.js`,
  `NavigationContext` (navigation only), `hooks/useChargingTests` (the one
  data hook: read-only SoC/kW curves by run id), and the shared UI
  components named in the rule's allow-list. Theme tokens are CSS
  variables, so they need no import. Anything else fails lint, so widen the list in the
  rule, with a reason, rather than working around it.
- **EVBench may import only `ExplainerLink`** (the "Learn more →" link for spec
  hints and platform pages) **and `ExplainersSection`** (the mount point under
  Reference). App.jsx owns only the URL (`&topic=<slug>`) and `openExplainer`.

`src/__tests__/explainersBoundary.test.js` checks that both halves still fire.

## Content format

A page is a flat file, `content/<slug>.md`: Markdown plus a few tags, parsed
by `parseExplainer.js` (its header lists the whole subset). The file name is
the slug. `::: engineers` and `::: held` are blocks closed by `:::`;
`::: lab <id>` and `::: figure <id> <caption>` place a component.
`::: tests <run ids> <caption>` shows EVBench's own charging tests (comma-
separated run ids) as a small kW-against-SoC preview with a link into
Charging Curves: real data beside the claim it supports. Use it wherever a
claim has a test that shows it. Labs are
registered in `ExplainerPage.jsx` (`LABS`); a figure with no component yet
renders as a labelled placeholder.

**Explainers are written in public** (owner, 2026-09-28). `status: DRAFT`
pages are readable on the site, tagged Draft on the landing page, with every
unverified citation marked where it sits. Planned topics show in the tree
too. `::: held` notes are editorial and show in development only.

A page drops `DRAFT` only when nothing it cites is unverified (accepted and observed are fine).
`explainers.test.js` fails a non-draft page that cites an unverified fact.

Styles go in `explainers.css`: tokens only, sizes from `--fs-body`. The
theme's guards read `index.css` only, so the boundary test guards this file.

## Accuracy

1. **Every factual sentence cites the ledger or is marked as a
   simplification.** Cite inline as `[[fact:<id>]]`, with the id taken from
   `facts.json`.
2. **Every fact has a `status`:**
   - `verified`: a dated source says it.
   - `accepted`: **widely accepted, with no source cited, by decision** (owner,
     2026-09-28). It can be published, and the page flags it as "widely
     accepted · no source cited". It needs a `rationale` saying why it counts
     as accepted, e.g. who treats it as given, or that it follows from
     arithmetic plus common practice. Use it for general engineering and
     industry knowledge. **Never** use it for one vehicle's or one product's
     figure (a kW, a voltage, a current rating): those need a source or stay
     unverified. If a source turns up later, upgrade it to verified.
   - `observed`: **observed by EVBench**, i.e. the owner's or a tester's
     first-hand experience with no published record: a rating label read at
     many sites, how a car behaves on a kind of charger. It can be published,
     flagged "observed by EVBench · no published record". Unlike
     `accepted`, it **may** be a specific product's or vehicle's figure,
     because that is what first-hand observation is. Its `rationale` says who
     saw what, and what would turn it into a rank-B source (usually an EVBench
     test that shows it).
   - **What `accepted` and `observed` may carry** (owner, 2026-09-28): context
     and recommendations, always with the caveat the tag shows. Never a
     premise that an argument's conclusion depends on. A lab preset may use
     one only when the lab names it on screen as a caveat (owner, approved
     2026-09-29). If a conclusion needs one, it needs a
     source first. explainers.test.js checks the lab presets.
   - `unverified`: a draft may cite it, and the page marks it; a finished
     page may not. Draft around it, or leave the sentence out. To flip one, fetch a primary source, record its URL and
   access date, and quote the part that says it in `note` if it is not
   obvious.
3. **Source ranks**, strongest first. Use the strongest one available, and
   flag a D:
   - **A:** manufacturer primary (press kit, spec sheet, data sheet, owner's
     manual, OEM technical paper)
   - **B:** independent measurement (EVBench runs, teardowns, academic tests,
     testers' logged data)
   - **C:** standards and physics (IEC 61851-23, SAE J1772/J3400, arithmetic)
   - **D:** secondary press, only when there is no A or B
   One maker describing another maker's hardware is D for that hardware.
4. **Name the pack, not the class.** Write "the iX3's 698.9 V pack", not "800 V
   packs are about 700 V". Class ranges are unsourced (`pack-voltage-class-ranges`).
5. **Say what the maker says.** BMW calls its method a "switching matrix". Until
   a BMW source says "split", neither does a page.
6. **Research goes in the ledger, not in memory.** Memory holds one pointer to
   this work (`explainers.md`). It does not hold facts.

## Footnotes

- `[^n]` numbered notes, listed at the end of the page.
- **Analogies are always footnoted with where they stop being true**, as a
  "Where it breaks:" note.
- In page text a run is a **test** ("charging test"), per `docs/vocabulary.md`.
  "Run" is fine in code and in these notes.
- **Simulations are labelled "model, not measurement"**, with the real EVBench
  run overlaid wherever one exists. Amps shown on a run are derived (P ÷
  modelled V), because runs record neither pack voltage nor current. Label them
  that way.

## Voice

The owner's voice, taken from their rewrite of `400v-charger-compatibility`
(2026-09-29), which replaced a terser, citation-driven first draft. Write new
pages in it, and when editing theirs, keep it.

- **Explain, don't list.** Flowing sentences that walk the reader through
  the idea, like a knowledgeable friend. Not clipped clause-stacks ("It is a
  class, not a reading.") and not a string of colons and dashes.
- **Lead with the why, then the trade-off.** Say why a maker would choose
  something ("Why do manufacturers use 800V?"), then what each choice costs:
  frame methods as engineering decisions with consequences, not a taxonomy.
- **Headings are plain questions or plain statements** of what the section
  answers: "Why do manufacturers use 800V?", "Tradeoffs in compatibility
  approaches", "When lower power may not mean significantly longer charging".
- **Short lead-in, then bullets for factors or requirements**, e.g. "the
  approach depends on several factors:" followed by the factors.
- **Worked numbers carry the point.** "Battery systems presenting at 300 V
  will receive at most 150 kW. Batteries at 450 V can charge at up to
  225 kW." One concrete case beats a formula in the short version; formulas
  go in "For engineers".
- **Industry shorthand is fine** ("400V" class, DCFC, "ride the line"), with
  informal terms in quotes and acronyms spelled out on first use (Battery
  Management System (BMS)).
- **Honest hedges, not hedging everything.** "it is possible that", "may
  not" where the claim really is conditional; plain statements elsewhere.
- **A light touch of wry is welcome** where the facts earn it (the CLA
  launching unable to use a 400 V charger at all).
- **Link sibling explainers inline** on a natural phrase ("for a variety of
  reasons") rather than "see also" lists.
- **Citations stay, but they don't shape the sentence.** Put
  `[[fact:…]]` at the end of the clause it supports; never contort a
  sentence to fit one, and never let the ledger's wording leak into prose.

## Page shape

One page, two depths: a plain-language **short version** first, then
**For engineers** blocks that expand. Both audiences read the same claims.
Real vehicles link into EVBench data: the vehicle, its platform
(`platformHref`), and the run that shows a claimed curve.

## Build order

Each step can ship alone:

1. `400v-vs-800v` + `400v-charger-compatibility` (drafts in `content/`)
2. `charging-curve-basics` + Charging Curve Lab
3. `voltage-vs-charge-time`
4. `what-limits-charging` + its three children + Cell Lab
5. `series-and-parallel`, `modules-vs-cell-to-pack`
6. The two hubs, written last because they summarise the pages under them.

## Tracking

GitHub: the `explainers` label, with #355 as the epic. Run explainer work in
its own Claude sessions.
