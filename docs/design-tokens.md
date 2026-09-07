# Design tokens

Every colour and radius the app is allowed to use, defined in `src/index.css` in
two blocks: `:root, [data-theme="light"]` and `[data-theme="dark"]`. All 65 are
defined in both — there is no token with only one value.

Specimens, live contrast ratios and a side-by-side of the two themes are on
`?tab=playground`. It is reachable signed out.

## The three rules

**1. Colour never goes inline.** Not `bg-blue-50`, not `#3b82f6`, not
`rgb(...)`. A palette utility is fixed — it looks right in one theme and wrong
in the other — and a literal is outside the system entirely. `npm run drift`
counts what remains; `npm run health` shows it beside every other ratchet.

**2. Never write `[data-theme="dark"] .foo`.** The selector is a descendant of
the document root, so a `.foo` inside a `[data-theme="light"]` pane is *still*
inside `html[data-theme="dark"]` and keeps the dark styling — light-mode
background under dark-mode text. The playground's side-by-side view is where
this shows up, and `playground.test.js` caps the ones that remain. Put the
difference in a **token** instead; that is what tokens are for.

**3. A token has both values or it is not a token.** `contrast.test.js` asserts
every name is defined in both blocks, and that the callout triad *inverts* —
dark text on a pale tint in light mode, light text on a dark wash in dark. That
test exists because `amber-800` on a dark panel shipped once.

## Reading the tables

`uses` counts every reference across `src/`, including the two definitions
themselves — so **2 means "defined, never used"**.

The light values are marked `/* provisional — light pass */` in the stylesheet
where they have not been ratified. Dark is the designed theme; see the light-mode
issue for what is outstanding.

#### Brand and accents

| token | light | dark | uses |
|---|---|---|---:|
| `accent-blue` | `rgb(37, 99, 235)` | `rgb(45, 127, 249)` | 10 |
| `accent-green` | `rgb(5, 150, 105)` | `rgb(35, 180, 126)` | 2 |
| `accent-grey` | `rgb(107, 114, 128)` | `rgb(107, 122, 143)` | 3 |
| `accent-orange` | `rgb(217, 119, 6)` | `rgb(242, 139, 60)` | 41 |
| `accent-orange-muted` | `rgba(217, 119, 6, 0.45)` | `rgba(242, 139, 60, 0.45)` | 3 |
| `accent-orange-surface` | `rgba(217, 119, 6, 0.10)` | `rgba(242, 139, 60, 0.10)` | 8 |
| `accent-violet` | `rgb(124, 58, 237)` | `rgb(155, 140, 240)` | 5 |
| `primary` | `rgb(59, 130, 246)` | `rgb(45, 127, 249)` | 129 |
| `primary-border` | `rgb(147, 197, 253)` | `rgba(45, 127, 249, 0.35)` | 8 |
| `primary-hover` | `rgb(37, 99, 235)` | `rgb(26, 110, 232)` | 6 |
| `primary-light` | `rgb(219, 234, 254)` | `rgba(45, 127, 249, 0.25)` | 17 |
| `primary-surface` | `rgb(219, 234, 254)` | `rgba(45, 127, 249, 0.15)` | 13 |
| `primary-text` | `rgb(30, 64, 175)` | `rgb(168, 203, 255)` | 21 |

#### Surfaces

| token | light | dark | uses |
|---|---|---|---:|
| `card` | `rgb(255, 255, 255)` | `rgb(17, 22, 31)` | 55 |
| `cluster` | `rgb(243, 244, 246)` | `rgb(21, 29, 43)` | 8 |
| `hover-lift` | `rgba(0, 0, 0, 0.05)` | `rgba(255, 255, 255, 0.07)` | 14 |
| `pinned` | `rgb(239, 246, 255)` | `rgb(19, 27, 40)` | 9 |
| `pinned-head` | `rgb(219, 234, 254)` | `rgb(22, 32, 46)` | 4 |
| `popover` | `rgb(255, 255, 255)` | `rgb(21, 27, 37)` | 11 |
| `surface-input` | `rgb(255, 255, 255)` | `rgb(15, 20, 28)` | 17 |
| `surface-muted` | `rgb(249, 250, 251)` | `rgb(15, 20, 28)` | 75 |
| `surface-sunken` | `rgb(243, 244, 246)` | `rgb(26, 34, 48)` | 43 |

#### Text

| token | light | dark | uses |
|---|---|---|---:|
| `text-accent` | `rgb(30, 64, 175)` | `rgb(168, 203, 255)` | 4 |
| `text-faint` | `rgb(156, 163, 175)` | `rgb(61, 74, 90)` | 34 |
| `text-header-label` | `rgb(55, 65, 81)` | `rgb(195, 204, 216)` | 4 |
| `text-link` | `rgb(29, 78, 216)` | `rgb(143, 186, 255)` | 5 |
| `text-meta` | `rgb(107, 114, 128)` | `rgb(124, 135, 152)` | 46 |
| `text-muted` | `rgb(107, 114, 128)` | `rgb(139, 149, 165)` | 30 |
| `text-nav-meta` | `rgb(219, 234, 254)` | `rgb(143, 176, 224)` | 5 |
| `text-on-nav` | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` | 7 |
| `text-primary` | `rgb(17, 24, 39)` | `rgb(242, 245, 249)` | 86 |
| `text-secondary` | `rgb(75, 85, 99)` | `rgb(168, 178, 193)` | 63 |
| `text-value` | `rgb(17, 24, 39)` | `rgb(230, 235, 242)` | 9 |

#### Lines

| token | light | dark | uses |
|---|---|---|---:|
| `border` | `rgb(229, 231, 235)` | `rgb(30, 39, 51)` | 197 |
| `border-strong` | `rgb(209, 213, 219)` | `rgb(42, 52, 65)` | 28 |
| `border-subtle` | `rgb(243, 244, 246)` | `rgb(27, 34, 44)` | 2 |

#### Status triad

| token | light | dark | uses |
|---|---|---|---:|
| `danger` | `rgb(239, 68, 68)` | `rgb(220, 75, 66)` | 49 |
| `danger-border` | `rgb(254, 202, 202)` | `rgba(232, 90, 80, 0.35)` | 10 |
| `danger-hover` | `rgb(220, 38, 38)` | `rgb(195, 61, 53)` | 3 |
| `danger-surface` | `rgb(254, 242, 242)` | `rgba(232, 90, 80, 0.14)` | 11 |
| `danger-text` | `rgb(153, 27, 27)` | `rgb(240, 146, 139)` | 13 |
| `success` | `rgb(34, 197, 94)` | `rgb(35, 180, 126)` | 33 |
| `success-border` | `rgb(187, 247, 208)` | `rgba(35, 180, 126, 0.35)` | 7 |
| `success-hover` | `rgb(22, 163, 74)` | `rgb(28, 150, 104)` | 2 |
| `success-surface` | `rgb(240, 253, 244)` | `rgba(35, 180, 126, 0.14)` | 9 |
| `success-text` | `rgb(22, 101, 52)` | `rgb(95, 214, 168)` | 9 |
| `warning` | `rgb(245, 158, 11)` | `rgb(242, 139, 60)` | 66 |
| `warning-border` | `rgb(253, 230, 138)` | `rgba(242, 139, 60, 0.35)` | 10 |
| `warning-hover` | `rgb(217, 119, 6)` | `rgb(224, 122, 43)` | 3 |
| `warning-surface` | `rgb(255, 251, 235)` | `rgba(242, 139, 60, 0.12)` | 13 |
| `warning-text` | `rgb(146, 64, 14)` | `rgb(245, 176, 119)` | 17 |

#### Other

| token | light | dark | uses |
|---|---|---|---:|
| `background` | `rgb(249, 250, 251)` | `rgb(13, 17, 23)` | 9 |
| `chart-axis` | `rgb(156, 163, 175)` | `rgb(61, 74, 90)` | 4 |
| `chart-grid` | `rgb(229, 231, 235)` | `rgb(26, 33, 44)` | 3 |
| `edit` | `rgb(34, 197, 94)` | `rgb(35, 180, 126)` | 7 |
| `edit-hover` | `rgb(22, 163, 74)` | `rgb(28, 150, 104)` | 3 |
| `nav-active` | `rgb(29, 78, 216)` | `rgb(23, 50, 87)` | 8 |
| `secondary` | `rgb(107, 114, 128)` | `rgb(97, 111, 130)` | 8 |
| `secondary-hover` | `rgb(75, 85, 99)` | `rgb(80, 92, 108)` | 3 |
| `--radius-card` | `` | `` | 7 |
| `--radius-chip` | `` | `` | 9 |
| `--radius-control` | `` | `` | 20 |
| `--radius-mark` | `` | `` | 8 |
| `--radius-popover` | `` | `` | 3 |
| `--radius-track` | `` | `` | 6 |

## Notes on specific tokens

**`text-meta` and `text-muted` are the same tier.** Identical in light
(`rgb(107,114,128)`), a shade apart in dark. Two names for one idea, 46 and 30
uses — worth collapsing to one.

**`primary-light` and `primary-surface` are identical in light**, and differ
only in dark (0.25 vs 0.15 alpha). `-light` is the older spelling; prefer
`-surface`, and prefer `-border` over a full-strength `--color-primary` on a
pale fill.

**`accent-green`, `border-subtle` and `success-hover` are unused** — 2 uses each,
which is their own two definitions. Either something should use them or they
should go.

**`accent-orange` is the "active / now" signal and nothing else may use it.**
That is the only reason it answers "where am I" from across the room. 41 uses:
the wordmark, the selected sub-tab, the median tick, the live charging pair.

**Status is a triad, not a colour.** Each of warning / danger / success carries
`-surface`, `-border` and `-text`, and they are used together. A component
picking one and inventing the other two is how `bg-amber-50 text-amber-700
border-amber-200` ended up written inline eight times.

## Radii

Six, and they encode what a thing *is*, not how round it looks: `--radius-card`
for a container, `--radius-control` for something you click, `--radius-chip` for
a pill, `--radius-mark` for a badge or a small tag, `--radius-track` for a bar,
`--radius-popover` for a panel that floats.

## See also

- [`typography.md`](typography.md) — the type scale and the role classes
- [`vocabulary.md`](vocabulary.md) — one name per thing
