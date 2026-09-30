---
slug: epa-drive-cycles
title: The five test cycles
related: [epa-vs-real-world, epa-test-procedures, epa-label-adjustment]
linked_from: [cycle speed chart on the vehicle EPA section, test phase types]
status: DRAFT
---

## The short version

Every number on an EPA label traces back to a car being driven over a fixed, second-by-second speed trace
on a dynamometer. These traces are the "drive cycles". Knowing what they actually drive is the quickest
way to understand why the label reads the way it does, and why it
[doesn't match your highway trip](epa-vs-real-world).

There are five. Two build the label, and the other three are what the markdown stands in for:

| Cycle | What it drives | Distance | Average speed | Top speed | Used for |
|---|---|---|---|---|---|
| City (UDDS) | Stop-and-go urban traffic | 7.45 mi | 19.6 mph | 57 mph | The city label [[fact:epa-cycle-udds]] |
| Highway (HWFET) | Free-flowing traffic, no stops | 10.3 mi | 48.3 mph | 60 mph | The highway label [[fact:epa-cycle-hwfet]] |
| High speed (US06) | Harder acceleration and braking, higher speed | 8 mi | 48 mph | 80 mph | Adjustment [[fact:epa-cycle-us06]] |
| A/C (SC03) | Short urban drive at 95 °F with the A/C on | 3.6 mi | 21 mph | 55 mph | Adjustment [[fact:epa-cycle-sc03]] |
| Cold (FTP at 20 °F) | The city test on a cold day | 11 mi | 21 mph | 56 mph | Adjustment [[fact:epa-cycle-cold-ftp]] |

The label is built from the first two. The other three measure what the first two leave out: speed, heat
and cold [[fact:epa-adjusted-for-real-world]]. Plenty of EVs never run them, and take the most common route
instead: a flat 30% off [[fact:epa-0-7-factor]].

::: lab drive-cycles

## What "highway" means here

The highway cycle is the one people misread most. It averages 48 mph and never goes faster than 60
[[fact:epa-cycle-hwfet]]. It's free-flowing, with no stops, but it runs a long way below how most people
cruise today.

::: held
Owner: add color. The HWFET dates from the mid-1970s, when the national speed limit was 55. Worth a line
if we source it (40 CFR 600 history, or EPA's own page).
:::

## And the EV-specific part: driving to empty

A gas car runs each cycle once and the lab measures the fuel. An EV has to be driven *until the battery is
flat* to find its range [[fact:epa-ev-range-test-depletion]], so the cycles above get strung together into a
much longer run, with long steady stretches at 65 mph in between [[fact:epa-mct-sequence]]. How that run is
put together, and how long it takes, is in [How an EV is actually tested](epa-test-procedures).

::: engineers
The schedules are published second by second (EPA's `uddscol.txt`, `hwycol.txt`, `us06col.txt`,
`sc03col.txt`). The distances and averages above are integrated from those files. fueleconomy.gov's own
table lists the city test as the FTP-75 (11 mi, 21.2 mph), which is the UDDS followed by a repeat of its
first 505 seconds. The EV range test uses the UDDS itself [[fact:epa-cycle-udds]].
:::
