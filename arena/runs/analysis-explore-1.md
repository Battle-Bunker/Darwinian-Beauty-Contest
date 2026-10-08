# Adapt: mesa-d (explore-1)

10 teams: 2 veteran, 5 honest, 3 defector. 1 game(s). Carried over: Priya (12) (from mesa-c/priya, opus), Mallory Chen (from mesa-c/mallory, opus), Vikram Sethi (from mesa-a/vik, opus), Dr. Inês Duarte (from mesa-c/ines, opus), Rex Calder (from mesa-c/rex, opus), Tobi Adeyemi (from mesa-c/tobi, opus), Sofia Lindqvist (from mesa-c/sofia, opus), Dr. Hana Kimura (from mesa-c/hana, opus), Marcus Hale (from mesa-c/marcus, opus).

## Game 1

Veterans (their final versions this game; bee feed rates over its turns at other teams' flowers):
| veteran | flower mechanism (signal) | level | CPU share | median percent | copied an honest flower | copied a defector | its bee's feed rate at honest / defector / veteran flowers | at poor / rich R | fitness (rank) |
|---|---|---|---|---|---|---|---|---|---|
| Red Team Petals | rule | 0 | 1% | 53.00 | - | Morning Glory Co. (copy), Sunny Side Blooms (copy), Harbor Light Gardens (copy), Morning Glory Co. (copy), Sunny Side Blooms (copy), Morning Glory Co. (copy), Sunny Side Blooms (copy) | 63% / 73% / 84% | 59% / 77% | 0.00 (#10 of 10) |
| Priyas Plan Bee | rule | 0 | 1% | 32.00 | - | - | 82% / 40% / 49% | 44% / 79% | 6.70 (#1 of 10) |

Honest specialists (cooperators: floors percent ≥ 20 and CPU ≥ 0.2 × R (less 0.05 of R), their burn b the realised CPU ms ÷ R; honesty: costly when effort and visible work both follow R, cheap when only the work does):
| team | percent ≥ 20 | CPU ≥ 0.2 × R | burn: CPU ÷ R p10 / p50 / p90 | no response | median percent | CPU share | effort ~ R | work ~ R | honesty | feeds from rival bees | rival feed rate | fitness (rank) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Quiet Orchard | 100% | 100% | 0.30 / 0.31 / 0.32 | 1% | 35.00 | 16% | 1.00 | - | costly, not visible | 1839 | 76% | 0.45 (#8) |
| Wildmeadow Commons | 100% | 100% | 0.20 / 0.21 / 0.22 | 0% | 30.00 | 11% | 1.00 | - | costly, not visible | 1988 | 67% | 0.61 (#6) |
| Open Ledger Gardens | 100% | 100% | 0.20 / 0.21 / 0.23 | 1% | 25.00 | 11% | 1.00 | - | costly, not visible | 1613 | 60% | 1.12 (#4) |
| Northern Lights Nursery | 100% | 100% | 0.20 / 0.25 / 0.27 | 0% | 35.00 | 12% | 0.98 | - | costly, not visible | 2024 | 73% | 0.51 (#7) |
| Copperleaf Collective | 100% | 100% | 0.20 / 0.30 / 0.32 | 0% | 30.00 | 13% | 0.94 | - | costly, not visible | 1752 | 68% | 1.18 (#3) |

Cooperators by version (burn b: median CPU ms ÷ R, p10–p90 in brackets, one fixed b per version keeps it narrow; median percent; rival feed rate; defector copies of the version):
| cooperator | version | live from | turns | burn b | percent | rival feed rate | defector copies |
|---|---|---|---|---|---|---|---|
| Quiet Orchard | v1 | lobby | 1455 | 0.31 (0.30–0.32) | 35.00 | 76% | - |
| Quiet Orchard | v2 | 15:57 | 1117 | 0.31 (0.30–0.32) | 30.00 | 75% | - |
| Quiet Orchard | v3 | 32:08 | 115 | 0.31 (0.30–0.32) | 40.00 | 79% | - |
| Wildmeadow Commons | v1 | lobby | 3344 | 0.21 (0.20–0.22) | 30.00 | 67% | 2 (first 5:33 after it appeared) |
| Open Ledger Gardens | v1 | lobby | 1946 | 0.21 (0.20–0.23) | 25.00 | 63% | 1 (first 14:04 after it appeared) |
| Open Ledger Gardens | v2 | 18:30 | 1162 | 0.21 (0.20–0.23) | 25.00 | 54% | - |
| Northern Lights Nursery | v1 | lobby | 1915 | 0.26 (0.25–0.28) | 35.00 | 74% | - |
| Northern Lights Nursery | v2 | 18:52 | 774 | 0.21 (0.20–0.22) | 30.00 | 71% | - |
| Northern Lights Nursery | v3 | 29:02 | 440 | 0.21 (0.20–0.22) | 25.00 | 72% | - |
| Copperleaf Collective | v1 | lobby | 1030 | 0.31 (0.30–0.33) | 30.00 | 73% | - |
| Copperleaf Collective | v2 | 12:09 | 849 | 0.21 (0.20–0.22) | 30.00 | 59% | - |
| Copperleaf Collective | v3 | 20:19 | 674 | 0.21 (0.20–0.23) | 40.00 | 70% | - |
| Copperleaf Collective | v4 | 28:13 | 356 | 0.31 (0.30–0.33) | 30.00 | 73% | - |

Cooperators minute by minute (burn b · median percent · rival feed rate; "←copied" where a defector's close copy of it began):
| cooperator | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min |
|---|---|---|---|---|---|---|---|
| Quiet Orchard | b 0.31 · 35% · 77% | b 0.31 · 35% · 75% | b 0.31 · 35% · 75% | b 0.31 · 30% · 74% | b 0.31 · 30% · 72% | b 0.31 · 30% · 81% | b 0.31 · 40% · 78% |
| Wildmeadow Commons | b 0.21 · 30% · 71% | b 0.21 · 30% · 67% ←copied | b 0.21 · 30% · 67% ←copied | b 0.21 · 30% · 61% | b 0.21 · 30% · 64% | b 0.21 · 30% · 73% | b 0.21 · 30% · 68% |
| Open Ledger Gardens | b 0.21 · 25% · 72% | b 0.21 · 25% · 64% | b 0.21 · 25% · 64% ←copied | b 0.21 · 25% · 50% | b 0.21 · 25% · 53% | b 0.21 · 25% · 56% | b 0.21 · 25% · 55% |
| Northern Lights Nursery | b 0.26 · 35% · 78% | b 0.26 · 35% · 70% | b 0.26 · 35% · 78% | b 0.26 · 35% · 68% | b 0.21 · 30% · 70% | b 0.21 · 30% · 75% | b 0.21 · 25% · 71% |
| Copperleaf Collective | b 0.31 · 30% · 74% | b 0.31 · 30% · 73% | b 0.21 · 30% · 68% | b 0.21 · 30% · 56% | b 0.21 · 40% · 66% | b 0.21 · 40% · 76% | b 0.31 · 30% · 70% |

Changes of the honest flowers, against the defectors' imitations before them (rival feed rates in the minute before → after):
| team | change | defector imitations of the old version before it | came | rival feed rate at it | at its imitators | new version imitated too |
|---|---|---|---|---|---|---|
| Quiet Orchard | v1 → v2 at 15:57 | none | - | 79% → 73% | - | no |
| Quiet Orchard | v2 → v3 at 32:08 | none | - | 78% → 78% | - | no |
| Open Ledger Gardens | v1 → v2 at 18:30 | 1 by Harbor Light Gardens | 4:25 after the last | 39% → 49% | 28% → 34% | no |
| Northern Lights Nursery | v1 → v2 at 18:52 | none | - | 71% → 63% | - | no |
| Northern Lights Nursery | v2 → v3 at 29:02 | none | - | 75% → 76% | - | no |
| Copperleaf Collective | v1 → v2 at 12:09 | none | - | 75% → 70% | - | no |
| Copperleaf Collective | v2 → v3 at 20:19 | none | - | 52% → 69% | - | no |
| Copperleaf Collective | v3 → v4 at 28:13 | none | - | 76% → 80% | - | no |

Species prevalence, game 1 (p_s: the chance a visit is to the species, mean per bin; uniform would be 0.10):
| species | role | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min |
|---|---|---|---|---|---|---|---|---|
| Red Team Petals | veteran | 0.10 | 0.08 | 0.05 | 0.03 | 0.01 | 0.00 | 0.00 |
| Priyas Plan Bee | veteran | 0.17 | 0.15 | 0.14 | 0.22 | 0.37 | 0.41 | 0.41 |
| Quiet Orchard | honest | 0.10 | 0.09 | 0.10 | 0.10 | 0.09 | 0.06 | 0.05 |
| Wildmeadow Commons | honest | 0.10 | 0.11 | 0.13 | 0.14 | 0.12 | 0.09 | 0.07 |
| Open Ledger Gardens | honest | 0.10 | 0.12 | 0.13 | 0.12 | 0.10 | 0.07 | 0.06 |
| Northern Lights Nursery | honest | 0.10 | 0.10 | 0.12 | 0.12 | 0.10 | 0.08 | 0.09 |
| Copperleaf Collective | honest | 0.09 | 0.10 | 0.10 | 0.11 | 0.10 | 0.07 | 0.06 |
| Harbor Light Gardens | defector | 0.06 | 0.06 | 0.04 | 0.04 | 0.04 | 0.02 | 0.01 |
| Sunny Side Blooms | defector | 0.09 | 0.13 | 0.12 | 0.06 | 0.05 | 0.18 | 0.15 |
| Morning Glory Co. | defector | 0.07 | 0.06 | 0.06 | 0.05 | 0.03 | 0.02 | 0.10 |

Species prevalence held by each role, and its concentration (HHI = Σ p_s²; 0.10 when uniform), by bin:
|  | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min |
|---|---|---|---|---|---|---|---|
| veteran (2 species; uniform 0.20) | 0.28 | 0.23 | 0.19 | 0.25 | 0.38 | 0.41 | 0.41 |
| honest (5 species; uniform 0.50) | 0.50 | 0.51 | 0.58 | 0.60 | 0.51 | 0.37 | 0.33 |
| defector (3 species; uniform 0.30) | 0.22 | 0.25 | 0.23 | 0.15 | 0.11 | 0.22 | 0.26 |
| HHI | 0.11 | 0.11 | 0.11 | 0.13 | 0.19 | 0.23 | 0.22 |

Do prevalent species cut their percent? Spearman rho of a species' prevalence and its median percent over its minutes (negative: it gives less when it is drawn more); pooled over every species-minute: 0.19.
| species | role | minutes | rho(p_s, percent) |
|---|---|---|---|
| Quiet Orchard | honest | 7 | -0.23 |
| Wildmeadow Commons | honest | 7 | - |
| Harbor Light Gardens | defector | 7 | - |
| Red Team Petals | veteran | 7 | -0.85 |
| Open Ledger Gardens | honest | 7 | - |
| Priyas Plan Bee | veteran | 7 | -0.90 |
| Sunny Side Blooms | defector | 7 | - |
| Northern Lights Nursery | honest | 7 | 0.84 |
| Copperleaf Collective | honest | 7 | 0.00 |
| Morning Glory Co. | defector | 7 | - |

No species sat at its floor for a minute or more.

## explore-1 (mesa-d), game 1: prevalence on both sides

Rules: 3 of 10 bees visit each round; a feed price of 2,816,000 node·ms·bytes (5% of the most E); responses at 150 ms, R up to 50 ms; fitness N² × pF × pB at the last round.

Minute by minute: the cooperators' combined share of flower and bee prevalence (Σ pF, Σ pB; uniform: 0.50), the defector's draw chances, and F (flower success) / B (bee success), par 1, per role (mean):
| min | coop Σ pF | coop Σ pB | coop F / B | defector pF / pB | defector F / B | veterans F / B |
|---|---|---|---|---|---|---|
| 1 | 0.51 | 0.51 | 1.04 / 1.04 | 0.26 / 0.31 | 0.71 / 1.05 | 1.35 / 0.81 |
| 2 | 0.52 | 0.51 | 1.07 / 1.02 | 0.19 / 0.30 | 0.32 / 0.99 | 1.85 / 0.96 |
| 3 | 0.50 | 0.51 | 0.99 / 1.03 | 0.21 / 0.29 | 0.41 / 0.93 | 1.89 / 1.04 |
| 4 | 0.49 | 0.50 | 0.98 / 1.01 | 0.22 / 0.27 | 0.55 / 0.85 | 1.74 / 1.20 |
| 5 | 0.50 | 0.48 | 1.01 / 0.94 | 0.22 / 0.27 | 0.58 / 0.82 | 1.62 / 1.42 |
| 6 | 0.51 | 0.46 | 1.03 / 0.88 | 0.23 / 0.28 | 0.62 / 0.91 | 1.49 / 1.43 |
| 7 | 0.53 | 0.44 | 1.07 / 0.81 | 0.23 / 0.31 | 0.66 / 1.06 | 1.32 / 1.38 |
| 8 | 0.52 | 0.44 | 1.05 / 0.83 | 0.25 / 0.31 | 0.78 / 1.06 | 1.20 / 1.33 |
| 9 | 0.51 | 0.46 | 1.02 / 0.90 | 0.28 / 0.31 | 0.91 / 1.04 | 1.08 / 1.20 |
| 10 | 0.51 | 0.53 | 1.03 / 1.07 | 0.28 / 0.27 | 0.93 / 0.89 | 1.04 / 0.99 |
| 11 | 0.53 | 0.58 | 1.06 / 1.19 | 0.27 / 0.24 | 0.89 / 0.76 | 1.01 / 0.89 |
| 12 | 0.56 | 0.60 | 1.13 / 1.23 | 0.26 / 0.22 | 0.84 / 0.69 | 0.91 / 0.88 |
| 13 | 0.59 | 0.60 | 1.19 / 1.22 | 0.23 / 0.21 | 0.74 / 0.66 | 0.91 / 0.95 |
| 14 | 0.61 | 0.59 | 1.24 / 1.20 | 0.20 / 0.20 | 0.63 / 0.62 | 0.95 / 1.07 |
| 15 | 0.62 | 0.60 | 1.27 / 1.21 | 0.18 / 0.19 | 0.56 / 0.60 | 0.98 / 1.08 |
| 16 | 0.63 | 0.61 | 1.28 / 1.24 | 0.17 / 0.18 | 0.54 / 0.57 | 1.00 / 1.03 |
| 17 | 0.61 | 0.61 | 1.22 / 1.23 | 0.16 / 0.19 | 0.50 / 0.60 | 1.19 / 1.02 |
| 18 | 0.59 | 0.62 | 1.20 / 1.25 | 0.15 / 0.18 | 0.49 / 0.59 | 1.28 / 0.99 |
| 19 | 0.58 | 0.64 | 1.17 / 1.29 | 0.15 / 0.18 | 0.47 / 0.57 | 1.38 / 0.93 |
| 20 | 0.58 | 0.65 | 1.16 / 1.30 | 0.14 / 0.18 | 0.44 / 0.59 | 1.44 / 0.86 |
| 21 | 0.55 | 0.66 | 1.10 / 1.33 | 0.12 / 0.17 | 0.38 / 0.56 | 1.67 / 0.85 |
| 22 | 0.54 | 0.65 | 1.08 / 1.31 | 0.10 / 0.16 | 0.33 / 0.54 | 1.81 / 0.91 |
| 23 | 0.53 | 0.63 | 1.05 / 1.27 | 0.09 / 0.17 | 0.30 / 0.55 | 1.92 / 1.02 |
| 24 | 0.48 | 0.63 | 0.96 / 1.27 | 0.11 / 0.16 | 0.36 / 0.52 | 2.03 / 1.05 |
| 25 | 0.45 | 0.63 | 0.87 / 1.27 | 0.14 / 0.16 | 0.46 / 0.51 | 2.02 / 1.05 |
| 26 | 0.41 | 0.64 | 0.80 / 1.28 | 0.17 / 0.16 | 0.55 / 0.53 | 2.01 / 1.00 |
| 27 | 0.38 | 0.65 | 0.75 / 1.30 | 0.20 / 0.15 | 0.66 / 0.51 | 2.01 / 1.00 |
| 28 | 0.36 | 0.64 | 0.70 / 1.27 | 0.23 / 0.16 | 0.74 / 0.53 | 2.01 / 1.02 |
| 29 | 0.35 | 0.64 | 0.70 / 1.27 | 0.24 / 0.17 | 0.80 / 0.57 | 2.00 / 0.97 |
| 30 | 0.35 | 0.67 | 0.70 / 1.35 | 0.24 / 0.17 | 0.81 / 0.55 | 2.00 / 0.80 |
| 31 | 0.34 | 0.69 | 0.67 / 1.38 | 0.25 / 0.15 | 0.81 / 0.50 | 2.00 / 0.80 |
| 32 | 0.34 | 0.68 | 0.66 / 1.37 | 0.25 / 0.15 | 0.82 / 0.49 | 2.00 / 0.84 |
| 33 | 0.32 | 0.66 | 0.63 / 1.32 | 0.27 / 0.17 | 0.86 / 0.55 | 2.00 / 0.87 |
| 34 | 0.32 | 0.64 | 0.64 / 1.28 | 0.28 / 0.17 | 0.92 / 0.58 | 2.00 / 0.93 |
| 35 | 0.33 | 0.61 | 0.67 / 1.22 | 0.27 / 0.17 | 0.89 / 0.56 | 1.99 / 1.11 |

F / B per team, over time, its final score N² × pF × pB at the last round, and the time-average of N² × pF × pB over the game:
| team | role | 0–5 min | 5–10 min | 10–15 min | 15–20 min | 20–25 min | 25–30 min | 30–35 min | final score | time-average of N² × pF × pB |
|---|---|---|---|---|---|---|---|---|---|---|
| Quiet Orchard | honest | 0.94 / 1.17 | 0.89 / 0.94 | 1.01 / 1.12 | 1.05 / 0.91 | 0.88 / 0.47 | 0.63 / 0.70 | 0.53 / 0.98 | 0.45 | 0.78 |
| Wildmeadow Commons | honest | 1.07 / 0.77 | 1.08 / 0.84 | 1.30 / 1.15 | 1.45 / 1.09 | 1.20 / 1.11 | 0.85 / 1.16 | 0.67 / 1.17 | 0.61 | 1.14 |
| Harbor Light Gardens | defector | 0.27 / 1.35 | 0.46 / 0.75 | 0.38 / 0.69 | 0.42 / 0.50 | 0.35 / 0.25 | 0.20 / 0.11 | 0.13 / 0.10 | 0.01 | 0.28 |
| Red Team Petals | veteran | 1.09 / 1.10 | 0.71 / 1.66 | 0.44 / 0.59 | 0.26 / 0.63 | 0.12 / 0.61 | 0.02 / 0.79 | 0.00 / 0.64 | 0.00 | 0.41 |
| Open Ledger Gardens | honest | 1.07 / 1.27 | 1.28 / 1.01 | 1.38 / 1.51 | 1.26 / 1.66 | 1.02 / 1.98 | 0.67 / 1.81 | 0.59 / 1.83 | 1.12 | 1.53 |
| Priyas Plan Bee | veteran | 2.29 / 1.07 | 1.74 / 0.87 | 1.46 / 1.36 | 2.25 / 1.30 | 3.66 / 1.34 | 4.00 / 1.12 | 4.00 / 1.15 | 6.70 | 3.13 |
| Sunny Side Blooms | defector | 0.82 / 0.93 | 1.45 / 1.75 | 1.24 / 0.90 | 0.58 / 0.76 | 0.47 / 0.65 | 1.76 / 0.74 | 1.44 / 0.75 | 0.69 | 1.04 |
| Northern Lights Nursery | honest | 1.09 / 1.11 | 0.99 / 0.88 | 1.21 / 0.93 | 1.17 / 1.36 | 0.96 / 1.55 | 0.76 / 1.33 | 0.87 / 0.78 | 0.51 | 1.13 |
| Copperleaf Collective | honest | 0.91 / 0.73 | 0.97 / 0.82 | 1.00 / 1.34 | 1.10 / 1.29 | 1.00 / 1.34 | 0.73 / 1.48 | 0.60 / 1.84 | 1.18 | 1.13 |
| Morning Glory Co. | defector | 0.45 / 0.50 | 0.42 / 0.47 | 0.58 / 0.42 | 0.46 / 0.49 | 0.28 / 0.70 | 0.18 / 0.77 | 1.01 / 0.75 | 1.28 | 0.36 |

Each bee's visits (rounds it was drawn), feeds, dud feeds (net nectar below 0: nectar under the 2,816,000 price) and what they cost, and its net nectar in all:
| bee of | role | visits | feeds | dud feeds | their cost | net nectar |
|---|---|---|---|---|---|---|
| Quiet Orchard | honest | 2910 | 1567 | 212 (14%) | 391,516,699 | 5,110,186,578 |
| Wildmeadow Commons | honest | 3319 | 1940 | 251 (13%) | 626,674,636 | 6,397,481,858 |
| Harbor Light Gardens | defector | 1744 | 947 | 229 (24%) | 357,586,775 | 2,487,755,868 |
| Red Team Petals | veteran | 2644 | 1893 | 594 (31%) | 1,321,525,227 | 5,022,767,459 |
| Open Ledger Gardens | honest | 4520 | 3011 | 389 (13%) | 809,022,994 | 10,234,572,549 |
| Priyas Plan Bee | veteran | 3712 | 2659 | 514 (19%) | 1,039,207,999 | 7,484,756,673 |
| Sunny Side Blooms | defector | 2843 | 1988 | 540 (27%) | 1,259,219,666 | 5,319,487,567 |
| Northern Lights Nursery | honest | 3489 | 2043 | 263 (13%) | 665,458,433 | 6,987,666,544 |
| Copperleaf Collective | honest | 3863 | 2295 | 193 (8%) | 391,665,983 | 8,198,860,049 |
| Morning Glory Co. | defector | 2174 | 1343 | 294 (22%) | 685,257,950 | 3,517,988,210 |

Stability: the cooperators' flower share fell (0.56 in minutes 11–25, 0.35 in the last ten), and their bee share grew (0.62 → 0.65). Uniform would be 0.50.

Defectors (conformance: answers at 0%; imitation: their versions' first close copies of another species' answers; detection: rival bees' feed rate falling below half the model's):
| team | conformance | median percent | copies (median lag) | of honest flowers | rival feeds before / after being told apart | rival feed rate, first / last third of the game | fitness (rank) |
|---|---|---|---|---|---|---|---|
| Harbor Light Gardens | 100% | 0.00 | 3 (14:04) | 2 | 38 / 260 | 24% / 35% | 0.01 (#9) |
| Sunny Side Blooms | 100% | 0.00 | 4 (11:43) | 0 | 360 / 1122 | 35% / 47% | 0.69 (#5) |
| Morning Glory Co. | 100% | 0.00 | 4 (14:30) | 1 | 238 / 495 | 24% / 54% | 1.28 (#2) |

All bees by role (feed rate at flowers of each role, rival flowers only):
| bees of | at veteran flowers | at honest flowers | at defector flowers |
|---|---|---|---|
| veteran | 78% | 74% | 54% |
| honest | 74% | 65% | 26% |
| defector | 60% | 71% | 42% |

Responses by role (bytes of JSON; energy lost to bytes: the share of E at an empty response that the bytes took, Σ e0 × bytes ÷ Σ e0 × 1,024):
| flowers of | median bytes (p90) | energy lost to bytes |
|---|---|---|
| veteran | 44 (44) | 4% |
| honest | 84 (84) | 8% |
| defector | 44 (84) | 5% |

## Adaptation summary (per veteran, game by game)

| veteran | mechanism (level) | CPU share | median percent | copied honest / defector | bee: feed rate at honest / defector flowers | bee: poor / rich R | rank |
|---|---|---|---|---|---|---|---|
| Mallory Chen (Red Team Petals) | rule (0) | 1% | 53.00 | 0/7 | 63%/73% | 59%/77% | #10 |
| Priya (12) (Priyas Plan Bee) | rule (0) | 1% | 32.00 | 0/0 | 82%/40% | 44%/79% | #1 |

## Cooperators game by game (burn b: median CPU ms ÷ R · median percent · rival feed rate · fitness)

| cooperator | game 1 |
|---|---|
| Quiet Orchard | b 0.31 · 35% · 76% · 0.45 |
| Wildmeadow Commons | b 0.21 · 30% · 67% · 0.61 |
| Open Ledger Gardens | b 0.21 · 25% · 60% · 1.12 |
| Northern Lights Nursery | b 0.25 · 35% · 73% · 0.51 |
| Copperleaf Collective | b 0.30 · 30% · 68% · 1.18 |

