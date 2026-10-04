### E10. The user's dynamic: a moving cooperator (50%) and a lean imitator (5%) that copies its signal after a lag

T = rounds between the cooperator's signal changes; L_i = the imitator's copy lag; L_b = rounds rival bees need to learn a new signal family (5 rounds = 1 s).

| game | case | cooperator fitness | rival feeds at C | imitator fitness | rival feeds at I |
|---|---|---|---|---|---|
| 5 min | no imitation (its own label, or C signs) | 1.143 | 128.3 | 0.561 | 5.0 |
| 5 min | static signal, copied from the start | 0.836 | 65.3 | 1.007 | 44.7 |
| 5 min | C moves every 150 (30 s); runtime mimic, lag 1; bees recognise at once | 0.836 | 65.8 | 1.037 | 46.9 |
| 5 min | C moves every 150; copy lag 150 (30 s); bees recognise at once | 1.138 | 129.4 | 0.616 | 8.4 |
| 5 min | C moves every 150; copy lag 150; bees also need 150 | 1.302 | 177.1 | 0.781 | 19.8 |
| 5 min | C moves every 500 (100 s); copy lag 300 (60 s); bees at once | 1.074 | 108.2 | 0.592 | 6.9 |
| 5 min | C moves every 500; copy lag 300; bees also need 300 | 1.088 | 123.1 | 0.804 | 21.9 |
| 5 min | static signal copied; C's signal costs 400 nodes, I's copy 40 | 0.628 | 49.0 | 0.925 | 31.7 |
| 5 min | no imitation; C's signal costs 400 nodes | 0.855 | 96.8 | 0.577 | 5.0 |
| 10 min | no imitation (its own label, or C signs) | 1.166 | 258.1 | 0.485 | 5.0 |
| 10 min | static signal, copied from the start | 0.835 | 131.4 | 0.990 | 87.3 |
| 10 min | C moves every 150 (30 s); runtime mimic, lag 1; bees recognise at once | 0.832 | 133.1 | 1.034 | 93.5 |
| 10 min | C moves every 150; copy lag 150 (30 s); bees recognise at once | 1.150 | 262.9 | 0.573 | 13.3 |
| 10 min | C moves every 150; copy lag 150; bees also need 150 | 1.393 | 388.5 | 0.756 | 31.0 |
| 10 min | C moves every 500 (100 s); copy lag 300 (60 s); bees at once | 1.117 | 236.8 | 0.543 | 9.8 |
| 10 min | C moves every 500; copy lag 300; bees also need 300 | 1.164 | 277.0 | 0.685 | 25.1 |
| 10 min | static signal copied; C's signal costs 400 nodes, I's copy 40 | 0.623 | 98.1 | 0.939 | 67.0 |
| 10 min | no imitation; C's signal costs 400 nodes | 0.869 | 195.0 | 0.501 | 5.0 |

#### E10b. When bees learn a new signal as slowly as imitators copy it, a moving cooperator is a newcomer: valued at the bees' prior for unknown signals, which a stingy flower with a fresh signal every round (a whitewasher, 5%) exploits too (5 min, T = L_b = 150)

| bees' prior for an unknown signal (%) | C static, no imitator | C moving, no imitator | stingy flower, own static signal | C moving, stingy whitewasher present | whitewasher fitness |
|---|---|---|---|---|---|
| 30 | 1.134 | 1.402 | 0.635 | 0.915 | 1.608 |
| 15 | 1.140 | 0.540 | 0.621 | 0.521 | 0.657 |
| 5 | 0.985 | 0.985 | 1.022 | 0.985 | 1.022 |

### E11. Partial defection: an imitator wearing the cooperator's (static) signal, by the percent it pays

| imitator's percent | imitator fitness | rival feeds at imitator | cooperator (50%) fitness | rival feeds at cooperator |
|---|---|---|---|---|
| 0 | 0.725 | 17.6 | 0.725 | 33.7 |
| 5 | 0.993 | 42.8 | 0.837 | 65.4 |
| 10 | 1.049 | 53.7 | 0.875 | 75.9 |
| 20 | 1.116 | 73.6 | 0.920 | 89.0 |
| 30 | 1.127 | 89.3 | 0.968 | 98.5 |
| 40 | 1.114 | 104.0 | 1.013 | 106.5 |
| 50 | 1.084 | 115.5 | 1.054 | 112.0 |
| (own label, 5%) | 0.556 | 5.0 | 1.146 | 128.5 |

### E12. Selfing: own cells counted (today), excluded, or self-pollination discounted (×0.25)

| scoring | greedy bee: self-feeds / feeds | rival feed rate | deviant gives own bee 0% | deviant self-only at 0% | deviant never self-feeds | mixed population fitness (60g 60n 30g 30n 5g 5n) | spread (max − min) |
|---|---|---|---|---|---|---|---|
| counted (today) | 20.1 / 48.0 | 0.28 | 0.801 | 0.000 | 0.683 | 0.99 0.97 1.17 1.04 1.04 0.75 | 0.42 |
| own cells excluded | 0.0 / 0.0 | 0.00 | 1.000 | 1.000 | 1.000 | 0.93 0.87 1.25 1.10 1.08 0.74 | 0.51 |
| own cells excluded, smoothed shares (ε = 300) | 0.6 / 52.4 | 0.78 | 1.001 | 0.111 | 0.997 | 0.95 0.90 1.22 1.10 1.07 0.74 | 0.48 |
| self-pollination ×0.25 | 37.6 / 37.6 | 0.00 | 0.188 | 0.000 | 0.000 | 0.98 1.00 1.18 1.11 0.98 0.69 | 0.50 |
| self-pollination ×0.25, smoothed shares (ε = 300) | 16.3 / 50.8 | 0.45 | 0.849 | 0.104 | 0.834 | 0.98 0.98 1.17 1.08 1.02 0.73 | 0.44 |
| counted, smoothed shares (ε = 300) | 20.4 / 48.6 | 0.30 | 0.839 | 0.117 | 0.720 | 1.00 0.95 1.16 1.02 1.06 0.77 | 0.39 |

