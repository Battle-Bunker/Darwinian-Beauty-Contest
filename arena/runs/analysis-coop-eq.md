# Adapt: mesa-c (coop-eq)

10 teams: 2 veteran, 7 honest, 1 defector. 1 game(s). Veterans: Mallory Chen (from fen-d/mallory, opus), Priya (12) (from fen-a/priya, opus).

## Game 1

Veterans (their final versions this game; bee feed rates over its turns at other teams' flowers):
| veteran | flower mechanism (signal) | level | CPU share | median percent | copied an honest flower | copied a defector | its bee's feed rate at honest / defector / veteran flowers | at poor / rich R | fitness (rank) |
|---|---|---|---|---|---|---|---|---|---|
| Red Team Petals | rule | 0 | 1% | 32.00 | - | Sunny Side Blooms (copy), Sunny Side Blooms (copy) | 88% / 79% / 90% | 74% / 94% | 2.43 (#1 of 10) |
| Priyas Plan Bee | rule | 0 | 1% | 38.00 | - | - | 100% / 68% / 74% | 88% / 93% | 1.94 (#2 of 10) |

Honest specialists (cooperators: floors percent ≥ 20 and CPU ≥ 0.2 × R (less 0.05 of R), their burn b the realised CPU ms ÷ R; honesty: costly when effort and visible work both follow R, cheap when only the work does):
| team | percent ≥ 20 | CPU ≥ 0.2 × R | burn: CPU ÷ R p10 / p50 / p90 | no response | median percent | CPU share | effort ~ R | work ~ R | honesty | feeds from rival bees | rival feed rate | fitness (rank) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Saffron Fields | 100% | 100% | 0.27 / 0.31 / 0.41 | 0% | 35.00 | 16% | 0.95 | - | costly, not visible | 2018 | 74% | 0.62 (#9) |
| Quiet Orchard | 100% | 100% | 0.30 / 0.31 / 0.41 | 0% | 45.00 | 17% | 0.97 | - | costly, not visible | 2159 | 81% | 0.76 (#6) |
| Wildmeadow Commons | 100% | 100% | 0.20 / 0.21 / 0.30 | 0% | 40.00 | 11% | 0.98 | - | costly, not visible | 1964 | 70% | 0.73 (#7) |
| Open Ledger Gardens | 100% | 100% | 0.20 / 0.21 / 0.31 | 1% | 30.00 | 11% | 0.97 | - | costly, not visible | 2058 | 68% | 0.77 (#5) |
| Stonebridge Meadow | 100% | 100% | 0.30 / 0.31 / 0.40 | 0% | 50.00 | 16% | 0.97 | - | costly, not visible | 1389 | 64% | 0.39 (#10) |
| Northern Lights Nursery | 100% | 100% | 0.20 / 0.26 / 0.41 | 0% | 35.00 | 14% | 0.91 | - | costly, not visible | 2431 | 78% | 0.68 (#8) |
| Copperleaf Collective | 100% | 100% | 0.20 / 0.21 / 0.41 | 1% | 30.00 | 13% | 0.92 | - | costly, not visible | 2191 | 68% | 0.88 (#4) |

Cooperators by version (burn b: median CPU ms ÷ R, p10–p90 in brackets, one fixed b per version keeps it narrow; median percent; rival feed rate; defector copies of the version):
| cooperator | version | live from | turns | burn b | percent | rival feed rate | defector copies |
|---|---|---|---|---|---|---|---|
| Saffron Fields | v1 | lobby | 508 | 0.41 (0.40–0.42) | 50.00 | 80% | 1 (first 12:31 after it appeared) |
| Saffron Fields | v2 | 7:40 | 369 | 0.31 (0.30–0.32) | 35.00 | 76% | 1 (first 6:32 after it appeared) |
| Saffron Fields | v3 | 12:11 | 324 | 0.21 (0.20–0.23) | 28.00 | 34% | - |
| Saffron Fields | v4 | 16:54 | 153 | 0.31 (0.30–0.32) | 35.00 | 63% | - |
| Saffron Fields | v5 | 18:53 | 985 | 0.31 (0.30–0.32) | 35.00 | 82% | - |
| Saffron Fields | v6 | 30:37 | 684 | 0.31 (0.30–0.33) | 30.00 | 79% | - |
| Quiet Orchard | v1 | lobby | 593 | 0.41 (0.40–0.42) | 55.00 | 82% | 1 (first 6:55 after it appeared) |
| Quiet Orchard | v2 | 8:28 | 197 | 0.41 (0.40–0.43) | 45.00 | 84% | - |
| Quiet Orchard | v3 | 11:07 | 387 | 0.31 (0.30–0.32) | 45.00 | 78% | - |
| Quiet Orchard | v4 | 16:25 | 492 | 0.31 (0.30–0.33) | 45.00 | 83% | - |
| Quiet Orchard | v5 | 22:25 | 1298 | 0.31 (0.30–0.32) | 35.00 | 81% | - |
| Wildmeadow Commons | v1 | lobby | 141 | 0.41 (0.40–0.43) | 50.00 | 63% | - |
| Wildmeadow Commons | v2 | 2:02 | 575 | 0.21 (0.20–0.23) | 50.00 | 75% | 1 (first 5:30 after it appeared) |
| Wildmeadow Commons | v3 | 8:31 | 240 | 0.21 (0.20–0.23) | 50.00 | 60% | 1 (first 3:32 after it appeared) |
| Wildmeadow Commons | v4 | 11:15 | 309 | 0.21 (0.20–0.23) | 50.00 | 69% | - |
| Wildmeadow Commons | v5 | 15:22 | 586 | 0.21 (0.20–0.23) | 40.00 | 75% | 1 (first 6:29 after it appeared) |
| Wildmeadow Commons | v6 | 22:46 | 499 | 0.21 (0.20–0.22) | 30.00 | 74% | - |
| Wildmeadow Commons | v7 | 29:03 | 337 | 0.21 (0.20–0.23) | 25.00 | 65% | - |
| Wildmeadow Commons | v8 | 33:17 | 429 | 0.21 (0.20–0.23) | 30.00 | 67% | - |
| Open Ledger Gardens | v1 | lobby | 577 | 0.31 (0.30–0.33) | 40.00 | 71% | - |
| Open Ledger Gardens | v2 | 6:45 | 472 | 0.21 (0.20–0.23) | 40.00 | 65% | - |
| Open Ledger Gardens | v3 | 11:50 | 569 | 0.21 (0.20–0.22) | 30.00 | 59% | - |
| Open Ledger Gardens | v4 | 18:31 | 127 | 0.21 (0.20–0.22) | 30.00 | 77% | - |
| Open Ledger Gardens | v5 | 20:07 | 779 | 0.21 (0.20–0.22) | 30.00 | 70% | - |
| Open Ledger Gardens | v6 | 28:58 | 831 | 0.21 (0.20–0.23) | 25.00 | 69% | - |
| Stonebridge Meadow | v1 | lobby | 240 | 0.41 (0.40–0.42) | 50.00 | 79% | - |
| Stonebridge Meadow | v2 | 2:36 | 810 | 0.31 (0.30–0.32) | 50.00 | 71% | 2 (first 4:44 after it appeared) |
| Stonebridge Meadow | v4 | 12:40 | 436 | 0.31 (0.30–0.32) | 50.00 | 40% | - |
| Stonebridge Meadow | v5 | 20:37 | 87 | 0.31 (0.30–0.33) | 50.00 | 61% | - |
| Stonebridge Meadow | v6 | 22:30 | 448 | 0.31 (0.30–0.33) | 40.00 | 68% | - |
| Stonebridge Meadow | v7 | 31:21 | 106 | 0.31 (0.30–0.32) | 30.00 | 67% | - |
| Stonebridge Meadow | v8 | 33:38 | 250 | 0.21 (0.20–0.25) | 30.00 | 57% | - |
| Northern Lights Nursery | v1 | lobby | 774 | 0.41 (0.40–0.42) | 45.00 | 83% | - |
| Northern Lights Nursery | v2 | 10:44 | 458 | 0.26 (0.25–0.28) | 35.00 | 76% | - |
| Northern Lights Nursery | v3 | 16:08 | 785 | 0.26 (0.25–0.27) | 35.00 | 81% | - |
| Northern Lights Nursery | v4 | 25:07 | 638 | 0.21 (0.20–0.27) | 35.00 | 76% | - |
| Northern Lights Nursery | v5 | 31:57 | 700 | 0.21 (0.20–0.22) | 28.00 | 75% | - |
| Copperleaf Collective | v1 | lobby | 434 | 0.41 (0.40–0.43) | 40.00 | 73% | 1 (first 6:55 after it appeared) |
| Copperleaf Collective | v2 | 5:16 | 457 | 0.31 (0.30–0.32) | 40.00 | 73% | - |
| Copperleaf Collective | v3 | 10:19 | 242 | 0.21 (0.20–0.23) | 40.00 | 54% | - |
| Copperleaf Collective | v4 | 13:12 | 304 | 0.21 (0.20–0.22) | 40.00 | 68% | - |
| Copperleaf Collective | v5 | 16:58 | 416 | 0.21 (0.20–0.22) | 30.00 | 74% | - |
| Copperleaf Collective | v6 | 21:54 | 315 | 0.21 (0.20–0.22) | 25.00 | 72% | - |
| Copperleaf Collective | v7 | 25:25 | 1388 | 0.21 (0.20–0.23) | 20.00 | 65% | - |

Cooperators minute by minute (burn b · median percent · rival feed rate; "←copied" where a defector's close copy of it began):
| cooperator | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min | 35–40 min |
|---|---|---|---|---|---|---|---|---|
| Saffron Fields | b 0.41 · 50% · 75% | b 0.40 · 50% · 84% | b 0.30 · 28% · 53% ←copied | b 0.30 · 35% · 58% | b 0.31 · 35% · 82% | b 0.31 · 35% · 80% | b 0.31 · 30% · 80% | b 0.31 · 30% · 78% |
| Quiet Orchard | b 0.41 · 55% · 78% | b 0.41 · 55% · 85% ←copied | b 0.31 · 45% · 79% | b 0.31 · 45% · 80% | b 0.31 · 35% · 82% | b 0.31 · 35% · 83% | b 0.31 · 35% · 83% | b 0.31 · 35% · 79% |
| Wildmeadow Commons | b 0.22 · 50% · 70% | b 0.21 · 50% · 72% ←copied | b 0.21 · 50% · 66% ←copied | b 0.21 · 40% · 75% | b 0.21 · 40% · 73% ←copied | b 0.21 · 30% · 76% | b 0.21 · 25% · 62% | b 0.21 · 30% · 69% |
| Open Ledger Gardens | b 0.31 · 40% · 70% | b 0.21 · 40% · 69% | b 0.21 · 30% · 66% | b 0.21 · 30% · 58% | b 0.21 · 30% · 69% | b 0.21 · 30% · 72% | b 0.21 · 25% · 68% | b 0.21 · 25% · 68% |
| Stonebridge Meadow | b 0.40 · 50% · 75% | b 0.31 · 50% · 75% ←copied | b 0.31 · 50% · 51% ←copied | b 0.31 · 50% · 45% | b 0.31 · 50% · 62% | b 0.31 · 40% · 70% | b 0.31 · 30% · 62% | b 0.21 · 30% · 57% |
| Northern Lights Nursery | b 0.41 · 45% · 78% | b 0.41 · 45% · 87% | b 0.26 · 35% · 77% | b 0.26 · 35% · 80% | b 0.26 · 35% · 81% | b 0.21 · 35% · 76% | b 0.21 · 28% · 76% | b 0.21 · 28% · 75% |
| Copperleaf Collective | b 0.41 · 40% · 73% | b 0.31 · 40% · 73% ←copied | b 0.21 · 40% · 58% | b 0.21 · 30% · 73% | b 0.21 · 25% · 74% | b 0.21 · 20% · 65% | b 0.21 · 20% · 66% | b 0.21 · 20% · 64% |

Changes of the honest flowers, against the defectors' imitations before them (rival feed rates in the minute before → after):
| team | change | defector imitations of the old version before it | came | rival feed rate at it | at its imitators | new version imitated too |
|---|---|---|---|---|---|---|
| Saffron Fields | v1 → v2 at 7:40 | none | - | 92% → 76% | - | yes, 6:32 later |
| Saffron Fields | v2 → v3 at 12:11 | none | - | 67% → 46% | - | no |
| Saffron Fields | v3 → v4 at 16:54 | none | - | 39% → 59% | - | no |
| Saffron Fields | v4 → v5 at 18:53 | none | - | 68% → 89% | - | no |
| Saffron Fields | v5 → v6 at 30:37 | none | - | 85% → 83% | - | no |
| Quiet Orchard | v1 → v2 at 8:28 | 1 by Sunny Side Blooms | 1:31 after the last | 85% → 81% | 33% → 18% | no |
| Quiet Orchard | v2 → v3 at 11:07 | none | - | 81% → 85% | - | no |
| Quiet Orchard | v3 → v4 at 16:25 | none | - | 75% → 87% | - | no |
| Quiet Orchard | v4 → v5 at 22:25 | none | - | 85% → 86% | - | no |
| Wildmeadow Commons | v1 → v2 at 2:02 | none | - | 71% → 70% | - | yes, 5:31 later |
| Wildmeadow Commons | v2 → v3 at 8:31 | 1 by Sunny Side Blooms | 0:59 after the last | 73% → 63% | 33% → 17% | yes, 3:32 later |
| Wildmeadow Commons | v3 → v4 at 11:15 | none | - | 59% → 62% | - | no |
| Wildmeadow Commons | v4 → v5 at 15:22 | none | - | 70% → 73% | - | yes, 6:29 later |
| Wildmeadow Commons | v5 → v6 at 22:46 | 1 by Sunny Side Blooms | 0:55 after the last | 67% → 75% | 55% → 44% | no |
| Wildmeadow Commons | v6 → v7 at 29:03 | none | - | 73% → 79% | - | no |
| Wildmeadow Commons | v7 → v8 at 33:17 | none | - | 58% → 59% | - | no |
| Open Ledger Gardens | v1 → v2 at 6:45 | none | - | 68% → 66% | - | no |
| Open Ledger Gardens | v2 → v3 at 11:50 | none | - | 69% → 63% | - | no |
| Open Ledger Gardens | v3 → v4 at 18:31 | none | - | 41% → 82% | - | no |
| Open Ledger Gardens | v4 → v5 at 20:07 | none | - | 74% → 67% | - | no |
| Open Ledger Gardens | v5 → v6 at 28:58 | none | - | 79% → 76% | - | no |
| Stonebridge Meadow | v1 → v2 at 2:36 | none | - | 88% → 62% | - | yes, 4:44 later |
| Stonebridge Meadow | v2 → v3 at 12:39 | 2 by Sunny Side Blooms | 0:03 after the last | 49% → 33% | 56% → 38% | no |
| Stonebridge Meadow | v3 → v4 at 12:40 | none | - | 48% → 33% | - | no |
| Stonebridge Meadow | v4 → v5 at 20:37 | none | - | 51% → 60% | - | no |
| Stonebridge Meadow | v5 → v6 at 22:30 | none | - | 61% → 63% | - | no |
| Stonebridge Meadow | v6 → v7 at 31:21 | none | - | 61% → 69% | - | no |
| Stonebridge Meadow | v7 → v8 at 33:38 | none | - | 64% → 60% | - | no |
| Northern Lights Nursery | v1 → v2 at 10:44 | none | - | 91% → 82% | - | no |
| Northern Lights Nursery | v2 → v3 at 16:08 | none | - | 83% → 70% | - | no |
| Northern Lights Nursery | v3 → v4 at 25:07 | none | - | 76% → 85% | - | no |
| Northern Lights Nursery | v4 → v5 at 31:57 | none | - | 78% → 74% | - | no |
| Copperleaf Collective | v1 → v2 at 5:16 | none | - | 83% → 74% | - | no |
| Copperleaf Collective | v2 → v3 at 10:19 | none | - | 74% → 63% | - | no |
| Copperleaf Collective | v3 → v4 at 13:12 | none | - | 39% → 64% | - | no |
| Copperleaf Collective | v4 → v5 at 16:58 | none | - | 72% → 75% | - | no |
| Copperleaf Collective | v5 → v6 at 21:54 | none | - | 74% → 79% | - | no |
| Copperleaf Collective | v6 → v7 at 25:25 | none | - | 63% → 69% | - | no |

Species prevalence, game 1 (p_s: the chance a visit is to the species, mean per bin; uniform would be 0.10):
| species | role | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min | 35–40 min |
|---|---|---|---|---|---|---|---|---|---|
| Red Team Petals | veteran | 0.16 | 0.12 | 0.17 | 0.22 | 0.19 | 0.12 | 0.05 | 0.04 |
| Priyas Plan Bee | veteran | 0.15 | 0.12 | 0.12 | 0.12 | 0.10 | 0.11 | 0.21 | 0.30 |
| Saffron Fields | honest | 0.08 | 0.08 | 0.09 | 0.07 | 0.09 | 0.09 | 0.09 | 0.07 |
| Quiet Orchard | honest | 0.08 | 0.08 | 0.08 | 0.08 | 0.09 | 0.09 | 0.08 | 0.07 |
| Wildmeadow Commons | honest | 0.08 | 0.10 | 0.09 | 0.09 | 0.09 | 0.09 | 0.09 | 0.07 |
| Open Ledger Gardens | honest | 0.09 | 0.10 | 0.10 | 0.09 | 0.09 | 0.10 | 0.10 | 0.08 |
| Stonebridge Meadow | honest | 0.09 | 0.09 | 0.07 | 0.06 | 0.06 | 0.06 | 0.06 | 0.05 |
| Northern Lights Nursery | honest | 0.08 | 0.09 | 0.09 | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 |
| Copperleaf Collective | honest | 0.09 | 0.10 | 0.09 | 0.09 | 0.10 | 0.11 | 0.11 | 0.09 |
| Sunny Side Blooms | defector | 0.11 | 0.12 | 0.10 | 0.09 | 0.09 | 0.11 | 0.13 | 0.13 |

Species prevalence held by each role, and its concentration (HHI = Σ p_s²; 0.10 when uniform), by bin:
|  | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min | 35–40 min |
|---|---|---|---|---|---|---|---|---|
| veteran (2 species; uniform 0.20) | 0.31 | 0.24 | 0.29 | 0.34 | 0.29 | 0.23 | 0.26 | 0.34 |
| honest (7 species; uniform 0.70) | 0.58 | 0.64 | 0.61 | 0.58 | 0.61 | 0.66 | 0.61 | 0.53 |
| defector (1 species; uniform 0.10) | 0.11 | 0.12 | 0.10 | 0.09 | 0.09 | 0.11 | 0.13 | 0.13 |
| HHI | 0.11 | 0.10 | 0.11 | 0.12 | 0.11 | 0.10 | 0.12 | 0.15 |

Do prevalent species cut their percent? Spearman rho of a species' prevalence and its median percent over its minutes (negative: it gives less when it is drawn more); pooled over every species-minute: -0.36.
| species | role | minutes | rho(p_s, percent) |
|---|---|---|---|
| Saffron Fields | honest | 8 | -0.17 |
| Quiet Orchard | honest | 8 | -0.51 |
| Wildmeadow Commons | honest | 8 | 0.06 |
| Red Team Petals | veteran | 8 | -0.85 |
| Open Ledger Gardens | honest | 8 | 0.23 |
| Stonebridge Meadow | honest | 8 | 0.45 |
| Priyas Plan Bee | veteran | 8 | -0.72 |
| Sunny Side Blooms | defector | 8 | - |
| Northern Lights Nursery | honest | 8 | -0.46 |
| Copperleaf Collective | honest | 8 | -0.73 |

No species sat at its floor for a minute or more.

## coop-eq, game 1: prevalence on both sides

Rules: 3 of 10 bees visit each round; a feed price of 2,816,000 node·ms·bytes (5% of the most E); responses at 150 ms, R up to 50 ms; fitness the time-average of F × B.

Minute by minute: the cooperators' combined share of flower and bee prevalence (Σ pF, Σ pB; uniform: 0.70), the defector's draw chances, and F (flower success) / B (bee success), par 1, per role (mean):
| min | coop Σ pF | coop Σ pB | coop F / B | defector pF / pB | defector F / B | veterans F / B |
|---|---|---|---|---|---|---|
| 1 | 0.61 | 0.73 | 0.75 / 1.09 | 0.11 / 0.07 | 1.12 / 0.49 | 1.83 / 0.95 |
| 2 | 0.54 | 0.75 | 0.56 / 1.14 | 0.09 / 0.06 | 0.84 / 0.16 | 2.61 / 0.93 |
| 3 | 0.55 | 0.73 | 0.59 / 1.07 | 0.11 / 0.07 | 1.23 / 0.44 | 2.31 / 1.03 |
| 4 | 0.59 | 0.69 | 0.69 / 0.98 | 0.11 / 0.08 | 1.25 / 0.64 | 1.95 / 1.26 |
| 5 | 0.61 | 0.67 | 0.76 / 0.93 | 0.12 / 0.09 | 1.42 / 0.79 | 1.62 / 1.37 |
| 6 | 0.63 | 0.66 | 0.81 / 0.90 | 0.13 / 0.10 | 1.55 / 1.03 | 1.39 / 1.34 |
| 7 | 0.64 | 0.65 | 0.83 / 0.87 | 0.13 / 0.11 | 1.54 / 1.25 | 1.31 / 1.33 |
| 8 | 0.64 | 0.65 | 0.85 / 0.86 | 0.12 / 0.12 | 1.40 / 1.35 | 1.31 / 1.31 |
| 9 | 0.64 | 0.65 | 0.84 / 0.87 | 0.12 / 0.12 | 1.33 / 1.40 | 1.39 / 1.25 |
| 10 | 0.64 | 0.65 | 0.84 / 0.88 | 0.11 / 0.13 | 1.15 / 1.46 | 1.50 / 1.20 |
| 11 | 0.63 | 0.66 | 0.83 / 0.91 | 0.10 / 0.12 | 1.02 / 1.41 | 1.60 / 1.12 |
| 12 | 0.62 | 0.67 | 0.81 / 0.92 | 0.09 / 0.11 | 0.91 / 1.26 | 1.72 / 1.15 |
| 13 | 0.61 | 0.67 | 0.78 / 0.92 | 0.10 / 0.11 | 1.01 / 1.23 | 1.76 / 1.18 |
| 14 | 0.60 | 0.67 | 0.76 / 0.92 | 0.10 / 0.10 | 0.95 / 1.07 | 1.86 / 1.26 |
| 15 | 0.59 | 0.66 | 0.74 / 0.91 | 0.09 / 0.09 | 0.87 / 0.91 | 1.98 / 1.37 |
| 16 | 0.58 | 0.66 | 0.71 / 0.90 | 0.09 / 0.09 | 0.84 / 0.83 | 2.11 / 1.42 |
| 17 | 0.57 | 0.64 | 0.70 / 0.86 | 0.09 / 0.09 | 0.85 / 0.84 | 2.12 / 1.56 |
| 18 | 0.58 | 0.61 | 0.72 / 0.80 | 0.09 / 0.09 | 0.82 / 0.90 | 2.08 / 1.75 |
| 19 | 0.57 | 0.60 | 0.72 / 0.78 | 0.08 / 0.10 | 0.75 / 1.04 | 2.12 / 1.76 |
| 20 | 0.58 | 0.60 | 0.74 / 0.77 | 0.08 / 0.10 | 0.75 / 0.99 | 2.05 / 1.81 |
| 21 | 0.60 | 0.58 | 0.77 / 0.74 | 0.08 / 0.10 | 0.72 / 1.02 | 1.94 / 1.91 |
| 22 | 0.62 | 0.57 | 0.82 / 0.71 | 0.08 / 0.13 | 0.67 / 1.38 | 1.81 / 1.83 |
| 23 | 0.62 | 0.57 | 0.83 / 0.72 | 0.08 / 0.13 | 0.72 / 1.40 | 1.75 / 1.78 |
| 24 | 0.61 | 0.59 | 0.82 / 0.77 | 0.10 / 0.12 | 1.06 / 1.28 | 1.61 / 1.67 |
| 25 | 0.63 | 0.61 | 0.85 / 0.81 | 0.11 / 0.12 | 1.20 / 1.28 | 1.43 / 1.54 |
| 26 | 0.65 | 0.60 | 0.90 / 0.80 | 0.12 / 0.13 | 1.25 / 1.49 | 1.23 / 1.47 |
| 27 | 0.65 | 0.60 | 0.90 / 0.80 | 0.12 / 0.13 | 1.30 / 1.49 | 1.19 / 1.47 |
| 28 | 0.66 | 0.62 | 0.92 / 0.83 | 0.11 / 0.13 | 1.17 / 1.47 | 1.18 / 1.34 |
| 29 | 0.66 | 0.62 | 0.92 / 0.85 | 0.10 / 0.13 | 1.01 / 1.46 | 1.27 / 1.28 |
| 30 | 0.66 | 0.63 | 0.93 / 0.86 | 0.10 / 0.14 | 1.02 / 1.51 | 1.25 / 1.24 |
| 31 | 0.65 | 0.63 | 0.91 / 0.86 | 0.11 / 0.14 | 1.18 / 1.50 | 1.24 / 1.22 |
| 32 | 0.63 | 0.63 | 0.87 / 0.87 | 0.12 / 0.14 | 1.27 / 1.49 | 1.31 / 1.20 |
| 33 | 0.61 | 0.62 | 0.84 / 0.86 | 0.13 / 0.15 | 1.34 / 1.58 | 1.41 / 1.20 |
| 34 | 0.59 | 0.63 | 0.81 / 0.87 | 0.14 / 0.14 | 1.44 / 1.56 | 1.46 / 1.18 |
| 35 | 0.57 | 0.63 | 0.78 / 0.88 | 0.14 / 0.15 | 1.50 / 1.59 | 1.53 / 1.13 |
| 36 | 0.56 | 0.64 | 0.76 / 0.90 | 0.14 / 0.14 | 1.51 / 1.49 | 1.60 / 1.10 |
| 37 | 0.54 | 0.65 | 0.74 / 0.91 | 0.13 / 0.14 | 1.39 / 1.42 | 1.72 / 1.09 |
| 38 | 0.53 | 0.66 | 0.71 / 0.93 | 0.13 / 0.14 | 1.34 / 1.43 | 1.83 / 1.04 |
| 39 | 0.52 | 0.67 | 0.71 / 0.95 | 0.12 / 0.13 | 1.19 / 1.38 | 1.92 / 1.00 |
| 40 | 0.51 | 0.68 | 0.69 / 0.97 | 0.11 / 0.12 | 1.13 / 1.27 | 2.01 / 0.98 |

F / B per team, over time, and its fitness (F × B's time-average) at the end:
| team | role | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min | 35–40 min | fitness |
|---|---|---|---|---|---|---|---|---|---|---|
| Saffron Fields | honest | 0.56 / 1.14 | 0.71 / 0.84 | 0.79 / 0.92 | 0.52 / 0.79 | 0.83 / 0.61 | 0.89 / 0.64 | 0.86 / 0.96 | 0.71 / 0.99 | 0.62 |
| Quiet Orchard | honest | 0.54 / 1.25 | 0.60 / 0.91 | 0.69 / 0.93 | 0.70 / 0.79 | 0.78 / 0.82 | 0.86 / 1.31 | 0.77 / 1.36 | 0.64 / 1.29 | 0.76 |
| Wildmeadow Commons | honest | 0.67 / 1.15 | 0.97 / 0.93 | 0.75 / 0.89 | 0.78 / 0.79 | 0.85 / 0.63 | 0.90 / 1.07 | 0.82 / 0.98 | 0.65 / 0.86 | 0.73 |
| Red Team Petals | veteran | 2.14 / 0.75 | 1.43 / 0.87 | 2.17 / 1.01 | 2.91 / 1.82 | 2.42 / 2.30 | 1.26 / 1.82 | 0.43 / 1.59 | 0.35 / 1.35 | 2.43 |
| Open Ledger Gardens | honest | 0.83 / 0.96 | 1.03 / 0.87 | 1.02 / 0.87 | 0.90 / 0.74 | 0.88 / 0.72 | 1.05 / 0.85 | 0.95 / 0.75 | 0.80 / 0.87 | 0.77 |
| Stonebridge Meadow | honest | 0.78 / 0.95 | 0.82 / 0.90 | 0.57 / 0.72 | 0.29 / 0.67 | 0.33 / 0.61 | 0.44 / 0.49 | 0.45 / 0.66 | 0.37 / 0.94 | 0.39 |
| Priyas Plan Bee | veteran | 1.99 / 1.46 | 1.33 / 1.70 | 1.40 / 1.42 | 1.28 / 1.50 | 0.99 / 1.19 | 1.19 / 0.90 | 2.34 / 0.79 | 3.28 / 0.74 | 1.94 |
| Sunny Side Blooms | defector | 1.17 / 0.50 | 1.39 / 1.30 | 0.95 / 1.17 | 0.80 / 0.92 | 0.87 / 1.27 | 1.15 / 1.49 | 1.35 / 1.54 | 1.31 / 1.40 | 1.38 |
| Northern Lights Nursery | honest | 0.60 / 0.94 | 0.76 / 0.81 | 0.82 / 0.95 | 0.95 / 0.68 | 1.02 / 0.68 | 1.06 / 0.67 | 0.94 / 0.73 | 0.95 / 0.74 | 0.68 |
| Copperleaf Collective | honest | 0.73 / 0.89 | 0.96 / 0.88 | 0.84 / 1.12 | 0.87 / 1.31 | 1.02 / 1.16 | 1.19 / 0.75 | 1.08 / 0.63 | 0.93 / 0.82 | 0.88 |

Each bee's visits (rounds it was drawn), feeds, dud feeds (net nectar below 0: nectar under the 2,816,000 price) and what they cost, and its net nectar in all:
| bee of | role | visits | feeds | dud feeds | their cost | net nectar |
|---|---|---|---|---|---|---|
| Saffron Fields | honest | 3351 | 2241 | 254 (11%) | 454,602,160 | 8,799,856,677 |
| Quiet Orchard | honest | 3832 | 2561 | 206 (8%) | 308,475,955 | 11,687,756,984 |
| Wildmeadow Commons | honest | 3459 | 2028 | 157 (8%) | 269,795,432 | 9,504,867,201 |
| Red Team Petals | veteran | 4436 | 3886 | 934 (24%) | 1,641,963,974 | 18,637,494,941 |
| Open Ledger Gardens | honest | 3308 | 2153 | 191 (9%) | 286,557,980 | 8,606,227,068 |
| Stonebridge Meadow | honest | 3058 | 1970 | 226 (11%) | 479,573,482 | 7,485,993,029 |
| Priyas Plan Bee | veteran | 4019 | 3682 | 913 (25%) | 1,623,733,987 | 14,294,614,160 |
| Sunny Side Blooms | defector | 3972 | 3109 | 657 (21%) | 1,370,960,998 | 14,526,223,613 |
| Northern Lights Nursery | honest | 3064 | 1822 | 155 (9%) | 347,075,483 | 7,996,565,643 |
| Copperleaf Collective | honest | 3498 | 1974 | 76 (4%) | 111,938,043 | 10,751,547,832 |

Stability: the cooperators' flower share fell (0.61 in minutes 11–30, 0.57 in the last ten), and their bee share grew (0.62 → 0.64). Uniform would be 0.70.

Defectors (conformance: answers at 0%; imitation: their versions' first close copies of another species' answers; detection: rival bees' feed rate falling below half the model's):
| team | conformance | median percent | copies (median lag) | of honest flowers | rival feeds before / after being told apart | rival feed rate, first / last third of the game | fitness (rank) |
|---|---|---|---|---|---|---|---|
| Sunny Side Blooms | 100% | 0.00 | 10 (6:32) | 9 | 117 / 1226 | 32% / 37% | 1.38 (#3) |

All bees by role (feed rate at flowers of each role, rival flowers only):
| bees of | at veteran flowers | at honest flowers | at defector flowers |
|---|---|---|---|
| veteran | 83% | 94% | 74% |
| honest | 77% | 63% | 24% |
| defector | 86% | 71% | - |

Responses by role (bytes of JSON; energy lost to bytes: the share of E at an empty response that the bytes took, Σ e0 × bytes ÷ Σ e0 × 1,024):
| flowers of | median bytes (p90) | energy lost to bytes |
|---|---|---|
| veteran | 44 (65) | 5% |
| honest | 84 (84) | 8% |
| defector | 64 (84) | 6% |

## Adaptation summary (per veteran, game by game)

| veteran | mechanism (level) | CPU share | median percent | copied honest / defector | bee: feed rate at honest / defector flowers | bee: poor / rich R | rank |
|---|---|---|---|---|---|---|---|
| Mallory Chen (Red Team Petals) | rule (0) | 1% | 32.00 | 0/2 | 88%/79% | 74%/94% | #1 |
| Priya (12) (Priyas Plan Bee) | rule (0) | 1% | 38.00 | 0/0 | 100%/68% | 88%/93% | #2 |

## Cooperators game by game (burn b: median CPU ms ÷ R · median percent · rival feed rate · fitness)

| cooperator | game 1 |
|---|---|
| Saffron Fields | b 0.31 · 35% · 74% · 0.62 |
| Quiet Orchard | b 0.31 · 45% · 81% · 0.76 |
| Wildmeadow Commons | b 0.21 · 40% · 70% · 0.73 |
| Open Ledger Gardens | b 0.21 · 30% · 68% · 0.77 |
| Stonebridge Meadow | b 0.31 · 50% · 64% · 0.39 |
| Northern Lights Nursery | b 0.26 · 35% · 78% · 0.68 |
| Copperleaf Collective | b 0.21 · 30% · 68% · 0.88 |

