---
slug: v2l-v2h-v2g
title: Can your EV power your devices? Your home? The grid?
status: DRAFT
---

## The short version

And can it help pay for the car?

Almost every EV has a battery big enough to run a home for days. A typical US home uses about 30 kWh a day
[[fact:ev-battery-days-of-home-use]], and Tesla's own estimate is that a Cybertruck can back up a house for over
three days [[fact:tesla-powershare-backup-duration]]. Getting that energy out is another matter. Very few cars can,
and what they are *allowed* to do varies far more than what their hardware could do. There are three levels, and
each one asks more of the car, the equipment on your wall and your utility [[fact:v2x-modes-defined]]:

- **Vehicle-to-load (V2L):** plug devices into outlets on the car, or into an adapter on its charge port.
- **Vehicle-to-home (V2H):** run your house from the car with the house cut off from the grid first, usually during an
  outage. The car stands in for the grid, the way a generator would.
- **Vehicle-to-grid (V2G):** run connected to the grid while it is up. The car might just cover your own evening use,
  or it might send power past your meter and sell it back to the utility.

As of October 2026, the Cybertruck may be the only EV on sale that does all three, and its grid support only works in a
few markets. The Nissan Leaf got to two of them years ago, home and grid through its CHAdeMO port, but it has no outlets
[[fact:nissan-leaf-v2h-v2g]]. GM's PowerShift and Tesla's Model 3/Y are sold for outage backup only. Ford's 2027
Fathom is the interesting newcomer: Ford is pitching everyday home use from the start, with less equipment on the wall
than anyone else.

The most useful thing to take away is the pattern. **Whether a car can export to the grid is mostly a question of
certification, software and utility programs, not hardware.**

## What each setup can do

Three American automakers show the range of what is on offer. Each row below is one of their solutions, the car plus
the equipment it needs at home, with its rated continuous output. A dash means that solution doesn't offer it; TBD
means the maker hasn't said yet. How each one works is further down the page.

| | Devices (V2L) | Home backup (V2H) | Grid support (V2G) |
|---|---|---|---|
| Ford Fathom + Home Power Station | TBD | – | >10 kW, projected[^1] |
| Ford Fathom + Station and Backup Panel | TBD | >10 kW, projected | >10 kW, projected[^1] |
| Tesla Model 3/Y, car only | 2.4 kW | – | – |
| Tesla Model 3/Y or Cybertruck + Powerwall | 2.4 kW (3/Y) or 9.6 kW (Cybertruck) | 11.5 kW | Powerwall's own energy only |
| Tesla Cybertruck + Powershare Gateway | 9.6 kW | 11.5 kW | 11.5 kW, limited markets |
| GM EV, car only | varies by model | – | – |
| GM EV + PowerShift V2H Bundle | varies by model | 9.6 kW | – (certified, not offered) |

## Does it pay?

Backup is insurance, and it is easy to value: it's worth whatever an outage would cost you. V2G is where a car could
earn money, in two ways. The first is time-of-use shifting: charge on cheap overnight power and run the house from the
car through the expensive evening. Each kWh shifted earns the price difference, less what is lost charging and
discharging, less the wear on the battery [[fact:arbitrage-net-per-kwh]]. The second is paid grid events, where the
utility pays well for power on its worst few afternoons of the year.

Here is our rough estimate for a car allowed to run grid-tied every day, in three kinds of market. The rates are
illustrative, not real tariffs, and the figures are per year [[fact:v2x-arbitrage-examples]].

| | California | Texas | Midwest |
|---|---|---|---|
| The rate | EV time-of-use, low export credit | Retail plan with free nights | Regulated, summer-only time-of-use |
| Time-of-use shifting | $250–600 | $510–600 | about $0 |
| Paid grid events | $200–600 | $100–500 | none yet |
| **Total** | **$450–1,200** | **$610–1,100** | **about $0** |

The shifting row assumes the car only covers your own evening use, and that anything it sends past the meter earns
nothing. Some markets pay well for evening exports, and there the figures would be higher. Two things hold it back
more than people expect:

- **Losses scale with the price you paid, not the spread.** Where overnight power is already expensive, as in
  California, a round trip that loses 15% eats a large share of the gap before battery wear is even counted.
- **Your house's evening use caps the volume.** Unless the utility pays close to retail for exports, a kWh beyond
  what your home uses that evening earns very little.

The hardware decides whether any of it pays back. GM's kit is $8,998 at list before installation
[[fact:gm-v2h-hardware]], a decade or more of the best case above. Tesla's Gateway is typically $1,950 plus $2,000 to
$4,000 to install [[fact:tesla-gateway-cost]]. Ford expects its Home Power Station to cost about half as much as its
first bidirectional charger [[fact:ford-fathom-home-power-station]], which could pay back in a few years. Today,
though, only a Cybertruck in the right market can earn any of it.

::: held
The revenue figures need real tariffs (PG&E EV2-A, an ERCOT free-nights plan, a DTE or Consumers TOU rate) before this
section drops its hedges, and an evening export credit for any market that pays one. The worked charts are in
LocalDev/explainers/v2x/. Ford's plan fee is unpriced and could decide the Ford case.
:::

## What about the battery and the warranty?

The system's app lets the owner set a minimum battery level where discharging stops, so you never find yourself
stranded with a flat car after an outage [[fact:tesla-discharge-limit]] [[fact:gm-reserve-level]].

The warranty is less clear. Tesla says taking part in its own Grid Support program doesn't affect the vehicle warranty
[[fact:tesla-grid-support-warranty]]. We couldn't find a matching statement from GM or Ford, or from Tesla for home
backup [[fact:v2x-warranty-unpublished]]. Daily shifting would also roughly double the energy the battery cycles
through in a year, so the question matters more for V2G than for the odd outage.

## How each automaker does it

**Ford Fathom.** The inverter is inside the truck, with more than 10 kW of projected output
[[fact:ford-fathom-onboard-inverter]]. Ford's Home Power Management, which runs the house from the truck through
expensive evening hours, needs only the Home Power Station on the wall, plus your utility's approval and a Ford plan.
Backup during an outage adds a Home Backup Power Panel [[fact:ford-fathom-home-power-station]]. Ford doesn't call
Home Power Management V2G, but by our definition it is: it runs alongside a live grid, and with no meter at the panel
nothing stops surplus from flowing out past yours [[fact:ford-fathom-hpm-can-export]].

**Tesla Model 3 and Model Y.** Home backup needs a Powerwall and a Wall Connector; the cheaper Powershare Gateway is
for Cybertruck only [[fact:tesla-m3y-powershare-needs-powerwall]]. Grid Support is "not available" for either car
[[fact:tesla-m3y-grid-support-unavailable]]. The owner's manuals say the car provides up to 11.5 kW
[[fact:tesla-m3y-manual-max-draw]], although it is possible that line was copied from the Cybertruck's manual[^2].

**Tesla Cybertruck.** Its bed has a 240 V outlet good for 9.6 kW [[fact:tesla-v2l-outputs]]. With the Gateway it backs
up a home on its own at 11.5 kW [[fact:tesla-powershare-system-ratings]], and Grid Support pays owners for exporting in
a few markets, including Texas and a PG&E pilot in California [[fact:tesla-cybertruck-grid-support]]. Adding a
Powerwall doesn't add to that: Tesla says credits then come from the Powerwall's own energy only
[[fact:tesla-powerwall-credits-only]].

**GM Energy PowerShift.** The car sends DC through GM's PowerShift Charger to a separate inverter on the wall
[[fact:gm-powershift-architecture]], with a Home Hub to cut the house off from the grid and a small "dark start" battery
that exists only to start the system with the grid down [[fact:gm-v2h-hardware]]. GM sells it for outages only
[[fact:gm-v2h-outage-only]]. Newer GM EVs with a NACS port have one more catch: they need one adapter to charge from the
PowerShift Charger and a different, nearly identical one for backup, which won't charge the car at all
[[fact:gm-nacs-adapter-swap]]. For a once-a-year outage that is a nuisance. For anything you'd do every day, it rules
the setup out.

::: engineers
### Ratings that matter for a whole house

Continuous power isn't the only limit. Motors draw several times their running current to start, and a backup system
has to supply that surge. GM's inverter is rated 9.6 kW off-grid at 45 °C but only 4.8 kW at 55 °C, and 62 A of
motor-start current [[fact:gm-inverter-e111-ratings]], against 110 A for Tesla's Gateway and 185 A with a Powerwall
[[fact:tesla-powershare-system-ratings]]. That gap matters for a well pump or a central air conditioner.

### Where the neutral comes from

An AC connection through a J1772 or J3400 port carries 240 V between two lines and ground, with no neutral
[[fact:j3400-ac-no-neutral]]. A house's 120 V circuits need one, so anything that backs up a home through the charge
port has to form a neutral somewhere else. Tesla's Gateway does it with a Neutral Balancing Transformer rated 18 A
continuous and 4.32 kVA [[fact:tesla-gateway-neutral-transformer]]. In load terms, the 120 V loads on the two legs
can differ by about 18 A, roughly 2.2 kW, so a house with large 120 V loads all on one leg can run out of neutral
before it runs out of power[^3]. With a Powerwall, the Powerwall forms the neutral. Ford hasn't said how its Backup
Power Panel does it.

### Who needs UL 1741 SB

UL 1741 covers an inverter's safety. Its SB supplement tests the grid-support behavior IEEE 1547-2018 asks for:
riding through disturbances, supporting voltage, and shutting off when the grid is gone [[fact:ul1741-sb-ieee1547]].
A utility asks for it before anything runs connected to its grid. Backup that cuts the house off first never touches a
live grid, so it doesn't need SB, any more than a standby generator does [[fact:islanded-backup-no-interconnection]].

So not every product here carries it, and a backup-only one doesn't have to:

- **Cybertruck with the Gateway** is listed to UL 1741 SB, as you'd expect from the one system that exports today
  [[fact:tesla-gateway-ul1741-sb]].
- **GM's e1.11 inverter** is listed to UL 1741 SB and California's Rule 21 and rated 11.5 kW on-grid
  [[fact:gm-inverter-e111-ratings]], even though GM sells it for outages only. The limit is GM's choice, not the box.
- **Model 3/Y** inverters are certified to UL 1741, and the system to UL 1741 CRD, but Tesla publishes no SB listing for
  them [[fact:tesla-pcs-ul1741]]. With a Powerwall, the car feeds a house the Powerwall has already cut off from the
  grid, so it doesn't need one for what it does today.
- **Ford Fathom** is "designed to meet" UL 1741 and IEEE 1547 [[fact:ford-fathom-onboard-inverter]]. It will need
  the listing before utilities approve Home Power Management, because that runs alongside the grid.
:::

[^1]: Ford projects more than 10 kW and has not announced paid export programs. Home Power Management runs alongside a
  live grid, which makes it V2G by our definition whether or not it ever sells power.
[^2]: Against reading it as the car's discharge rating: 11.5 kW is exactly a 48 A Wall Connector's charging ceiling,
  and the manual's own example screen shows 4.8 kW. For it: the line sits in the Home Backup section and says the car
  "provides" the draw.
[^3]: Our reading of Tesla's neutral current rating: 18 A × 120 V ≈ 2.2 kW of imbalance between the two legs.
