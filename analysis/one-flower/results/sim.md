### E1. One deviant bee among greedy bees (N = 6)

| rounds | team 0's bee | fitness | others' mean | pollination share ×N | forage share ×N | feeds | self-feeds | rival feed rate | rival bees' feeds at team 0 |
|---|---|---|---|---|---|---|---|---|---|
| 600 | greedy (the population's own) | 1.004 | 0.999 | 1.000 | 1.004 | 48.0 | 20.1 | 0.28 | 27.7 |
| 600 | naive: feeds at every flower | 0.958 | 1.007 | 0.906 | 1.057 | 55.0 | 8.9 | 1.00 | 28.7 |
| 600 | self only: feeds only at its own flower | 0.623 | 1.050 | 1.218 | 0.512 | 37.8 | 37.8 | 0.00 | 24.3 |
| 600 | thresh 20: own flower, and labels paying >= 20% | 0.958 | 1.007 | 0.906 | 1.057 | 55.0 | 8.9 | 1.00 | 28.7 |
| 600 | greedy, but never at its own flower | 0.683 | 1.069 | 0.767 | 0.891 | 47.2 | 0.0 | 0.43 | 28.4 |
| 600 | never feeds | 0.000 | 1.231 | 0.873 | 0.000 | 0.0 | 0.0 | 0.00 | 23.1 |
| 600 | greedy, no handshake (can't recognise its own flower) | 0.978 | 1.004 | 1.022 | 0.957 | 48.9 | 18.2 | 0.32 | 28.0 |
| 600 | greedy, gives its own bee 100% (keeps no pollen from it) | 0.853 | 1.025 | 0.786 | 1.086 | 44.8 | 15.9 | 0.23 | 27.4 |
| 600 | greedy, flower gives everyone 100% | 0.000 | 1.433 | 0.000 | 0.028 | 0.2 | 0.2 | 0.00 | 80.1 |
| 3000 | greedy (the population's own) | 1.004 | 0.999 | 1.000 | 1.003 | 243.6 | 97.6 | 0.31 | 144.9 |
| 3000 | naive: feeds at every flower | 0.963 | 1.006 | 0.915 | 1.053 | 273.0 | 46.4 | 1.00 | 149.2 |
| 3000 | self only: feeds only at its own flower | 0.616 | 1.051 | 1.216 | 0.507 | 188.4 | 188.4 | 0.00 | 124.8 |
| 3000 | thresh 20: own flower, and labels paying >= 20% | 0.963 | 1.006 | 0.915 | 1.053 | 273.0 | 46.4 | 1.00 | 149.2 |
| 3000 | greedy, but never at its own flower | 0.706 | 1.063 | 0.766 | 0.921 | 260.3 | 0.0 | 0.79 | 148.2 |
| 3000 | never feeds | 0.000 | 1.229 | 0.879 | 0.000 | 0.0 | 0.0 | 0.00 | 119.3 |
| 3000 | greedy, no handshake (can't recognise its own flower) | 0.979 | 1.004 | 1.018 | 0.962 | 249.6 | 86.8 | 0.39 | 146.4 |
| 3000 | greedy, gives its own bee 100% (keeps no pollen from it) | 0.880 | 1.018 | 0.790 | 1.115 | 246.2 | 82.2 | 0.37 | 145.3 |
| 3000 | greedy, flower gives everyone 100% | 0.000 | 1.435 | 0.000 | 0.021 | 0.4 | 0.4 | 0.00 | 457.1 |

### E2. Number of teams: do greedy bees feed at rivals, and does staying home pay?

| N | greedy bee: rival feed rate | feeds | self-feeds | self-only deviant: fitness | others | naive deviant: fitness | others |
|---|---|---|---|---|---|---|---|
| 2 | 0.00 | 50.1 | 50.1 | 0.999 | 1.001 | 0.663 | 1.233 |
| 3 | 0.02 | 46.4 | 44.4 | 0.975 | 1.003 | 0.807 | 1.071 |
| 4 | 0.11 | 45.8 | 33.9 | 0.853 | 1.028 | 0.885 | 1.030 |
| 6 | 0.28 | 48.0 | 20.1 | 0.623 | 1.050 | 0.958 | 1.007 |
| 8 | 0.32 | 47.7 | 13.0 | 0.482 | 1.055 | 0.982 | 1.002 |

### E3. The percent offered to rival bees: best response of team 0 to a population at p0

| world | best-response path from 30 | fixed point | team 0's fitness by its percent, at the fixed point (p:fitness) |
|---|---|---|---|
| signatures, greedy bees | 30 → 60 | 60 | 0:0.44 2:0.44 5:0.44 10:0.44 15:0.75 20:0.74 25:0.86 30:0.87 40:0.97 50:1.00 60:1.01 80:0.90 |
| no signals (one shared label), greedy bees | 30 → 0 → 15 → 0 → 15 → 0 | 0 | 0:1.14 2:1.10 5:1.10 10:1.06 15:1.01 20:0.97 25:0.96 30:0.93 40:0.86 50:0.79 60:0.74 80:0.60 |
| signatures, naive bees (feed everywhere) | 30 → 0 | 0 | 0:1.05 2:0.89 5:0.81 10:0.73 15:0.68 20:0.63 25:0.59 30:0.56 40:0.50 50:0.44 60:0.39 80:0.29 |
| signatures, thresh-20 bees | 30 → 20 | 20 | 0:0.26 2:0.26 5:0.26 10:0.26 15:0.25 20:1.02 25:0.98 30:0.94 40:0.87 50:0.80 60:0.73 80:0.55 |

### E4. The percent a flower gives its own bee (self-feeds through the handshake)

| pOwn | fitness | pollination share ×N | forage share ×N | self-feeds |
|---|---|---|---|---|
| 0 | 0.801 | 0.980 | 0.817 | 9.8 |
| 10 | 0.916 | 1.017 | 0.901 | 14.7 |
| 25 | 0.969 | 1.025 | 0.945 | 17.2 |
| 40 | 0.996 | 1.015 | 0.981 | 19.0 |
| 50 | 1.004 | 1.000 | 1.004 | 20.1 |
| 60 | 1.008 | 0.987 | 1.021 | 20.6 |
| 75 | 1.001 | 0.951 | 1.053 | 21.5 |
| 90 | 0.976 | 0.896 | 1.089 | 21.1 |
| 100 | 0.853 | 0.786 | 1.086 | 15.9 |

### E5. Mimicry: a stingy flower (5%) wearing a generous flower's label (team 1, 50%)

| bees' prior for an unknown label (%) | team 0 (stingy, 5%) | team 0 fitness | rival feeds at team 0 | team 1 (generous, 50%) fitness | rival feeds at team 1 | teams 2–5 mean |
|---|---|---|---|---|---|---|
| 30 | stingy, its own unique label | 0.403 | 1.0 | 1.179 | 47.2 | 1.109 |
| 30 | stingy, copies team 1's label exactly | 0.973 | 17.2 | 0.843 | 25.1 | 1.045 |
| 30 | stingy; no flower has a signal (all show one label) | 1.206 | 27.6 | 0.836 | 27.7 | 0.994 |
| 30 | stingy, a fresh label every round (whitewashing) | 1.571 | 53.2 | 0.933 | 44.5 | 0.887 |
| 5 | stingy, its own unique label | 1.010 | 0.0 | 1.001 | 0.0 | 0.998 |
| 5 | stingy, copies team 1's label exactly | 1.010 | 0.0 | 1.001 | 0.0 | 0.998 |
| 5 | stingy; no flower has a signal (all show one label) | 1.010 | 0.0 | 1.001 | 0.0 | 0.998 |
| 5 | stingy, a fresh label every round (whitewashing) | 1.010 | 0.0 | 1.001 | 0.0 | 0.998 |

#### E5b. The generous flower rotates its signal every T = 100 rounds; the mimic copies each new one after a lag L

| copy lag L (rounds) | mimic fitness | rival feeds at mimic | generous fitness | rival feeds at generous |
|---|---|---|---|---|
| 0 | 1.026 | 18.4 | 0.847 | 25.7 |
| 10 | 0.915 | 13.3 | 0.886 | 27.7 |
| 25 | 0.846 | 10.4 | 0.951 | 33.1 |
| 50 | 0.735 | 7.8 | 1.057 | 41.9 |
| 100 | 0.562 | 3.9 | 1.153 | 48.6 |
| never copies | 0.404 | 1.0 | 1.179 | 47.1 |
| (no rotation, no copying) | 0.403 | 1.0 | 1.179 | 47.2 |

### E6. Proof of work: the same flower with 85% of its CPU burned (E 24,474 instead of 156,299)

| case | team 0 fitness | others' mean | rival feeds at team 0 | pollination share ×N | forage share ×N |
|---|---|---|---|---|---|
| signatures everywhere; team 0 cheap (MAC flower) | 1.004 | 0.999 | 27.7 | 1.000 | 1.004 |
| signatures everywhere; team 0 burns 85% on proof of work | 0.216 | 1.174 | 5.0 | 0.240 | 0.903 |
| signatures everywhere; team 0 minimal, no handshake (E 162,721) | 1.009 | 0.998 | 28.7 | 1.054 | 0.958 |
| no signals but team 0's; team 0 generous (50%), cheap signature | 1.052 | 0.989 | 46.1 | 1.089 | 0.966 |
| no signals but team 0's; team 0 generous (50%), proof-of-work signal | 0.239 | 1.168 | 10.0 | 0.262 | 0.913 |
| no signals; team 0 stingy (5%) does the same proof of work (an honest understudy) | 0.126 | 1.208 | 1.1 | 0.150 | 0.838 |

### E7. Autarky: does a world of self-feeders hold? (rows: everyone plays the row; team 0 deviates)

| world | fitness (all alike) | team 0 deviates to | team 0 fitness | others' mean |
|---|---|---|---|---|
| everyone self-only (handshake), p to rivals 30 | 1.012 | greedy bee | 1.201 | 0.936 |
| everyone self-only (handshake), p to rivals 30 | 1.012 | naive bee | 0.678 | 0.919 |
| everyone self-only (handshake), p to rivals 30 | 1.012 | greedy, flower pays rivals 50% | 1.201 | 0.936 |
| everyone self-only, flowers give rivals 0 | 1.012 | greedy bee | 0.768 | 1.049 |
| everyone self-only, flowers give rivals 0 | 1.012 | naive bee | 0.179 | 1.241 |
| everyone self-only, flowers give rivals 0 | 1.012 | greedy, flower pays rivals 50% | 0.768 | 1.049 |
| everyone greedy, no signals (one shared label), rivals get 0 | 1.000 | greedy bee | 1.000 | 1.000 |
| everyone greedy, no signals (one shared label), rivals get 0 | 1.000 | naive bee | 0.222 | 1.223 |
| everyone greedy, no signals (one shared label), rivals get 0 | 1.000 | greedy, flower pays rivals 50% | 0.969 | 1.009 |

### E8. The proposed flower-constancy rule: pollen counts only if the bee's next feed is at the same species

| rule | team 0's bee | fitness | others' mean | feeds | self-feeds | rival feed rate | team 0's pollen that counts | of it, from rival bees | others: rival pollen that counts |
|---|---|---|---|---|---|---|---|---|---|
| today | greedy (the population's own) | 1.004 | 0.999 | 48.0 | 20.1 | 0.28 | 1.00 | 1.00 | 1.00 |
| today | naive | 0.958 | 1.007 | 55.0 | 8.9 | 1.00 | 1.00 | 1.00 | 1.00 |
| today | self only | 0.623 | 1.050 | 37.8 | 37.8 | 0.00 | 1.00 | 1.00 | 1.00 |
| today | greedy, never at its own flower | 0.683 | 1.069 | 47.2 | 0.0 | 0.43 | 1.00 | 1.00 | 1.00 |
| constancy | greedy (the population's own) | 1.000 | 1.000 | 39.3 | 33.1 | 0.04 | 0.74 | 0.00 | 0.00 |
| constancy | naive | 0.254 | 1.089 | 55.0 | 9.7 | 1.00 | 0.08 | 0.00 | 0.09 |
| constancy | self only | 0.712 | 1.051 | 37.9 | 37.9 | 0.00 | 0.80 | 0.00 | 0.00 |
| constancy | greedy, never at its own flower | 0.000 | 1.381 | 2.8 | 0.0 | 0.01 | 0.00 | 0.00 | 0.00 |
| constancy + delivery pays the bee | greedy (the population's own) | 1.006 | 0.999 | 39.4 | 32.8 | 0.04 | 0.72 | 0.00 | 0.00 |
| constancy + delivery pays the bee | naive | 0.238 | 1.098 | 55.0 | 9.1 | 1.00 | 0.08 | 0.00 | 0.10 |
| constancy + delivery pays the bee | self only | 0.795 | 1.036 | 37.8 | 37.8 | 0.00 | 0.78 | 0.00 | 0.00 |
| constancy + delivery pays the bee | greedy, never at its own flower | 0.000 | 1.392 | 2.8 | 0.0 | 0.01 | 0.00 | 0.00 | 0.00 |

#### E8b. Mimicry under each rule (bees' prior 30%; team 1 generous at 50%, team 0 stingy at 5%)

| rule | team 0 | team 0 fitness | rival feeds at team 0 | team 1 (generous) fitness | rival feeds at team 1 | team 1's rival pollen that counts |
|---|---|---|---|---|---|---|
| today | stingy, its own label | 0.403 | 1.0 | 1.179 | 47.2 | 1.00 |
| today | stingy, copies team 1's label | 0.973 | 17.2 | 0.843 | 25.1 | 1.00 |
| constancy | stingy, its own label | 1.049 | 2.5 | 0.927 | 10.6 | 0.00 |
| constancy | stingy, copies team 1's label | 1.063 | 4.5 | 0.968 | 6.7 | 0.00 |
| constancy + delivery pays the bee | stingy, its own label | 1.144 | 2.8 | 0.950 | 7.9 | 0.00 |
| constancy + delivery pays the bee | stingy, copies team 1's label | 1.228 | 5.2 | 0.924 | 7.1 | 0.00 |

#### E8c. Team 0's percent to rival bees against a population at 30%, under each rule

| rule | team 0's fitness by its percent to rivals (p:fitness) |
|---|---|
| today | 0:0.40 10:0.66 20:0.88 30:1.00 40:1.06 50:1.06 60:1.07 80:0.92 |
| constancy | 0:1.08 10:1.03 20:1.02 30:1.00 40:1.00 50:0.97 60:0.95 80:0.93 |
| constancy + delivery pays the bee | 0:1.23 10:1.15 20:1.04 30:1.01 40:1.00 50:1.00 60:0.97 80:0.96 |

