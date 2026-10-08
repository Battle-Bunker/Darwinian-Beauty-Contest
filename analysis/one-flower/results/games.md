#### G1. Energy: the same bees, four flowers (N = 4, every bee feeds everywhere) (mean of 6 games of 600 rounds; too slow: total)

| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rule, 30% | 33 | 0.7 | 159261 | 43.0 | 30.0 | 55.0 | 16.3 | 1.000 | 25210 | 0.4 / 2.4 | 0 | 1.335 | 0.995 | 1.329 ± 0.11 |
| rule + MAC handshake code, 30% | 120 | 0.9 | 146134 | 40.5 | 30.0 | 55.0 | 13.8 | 1.000 | 28240 | 0.4 / 2.5 | 0 | 1.226 | 1.004 | 1.230 ± 0.04 |
| proof of work 60 ms, 30% | 84 | 60.8 | 90669 | 40.7 | 30.0 | 55.0 | 13.8 | 1.000 | 33717 | 0.4 / 3.1 | 0 | 0.967 | 0.999 | 0.967 ± 0.09 |
| proof of work 125 ms, 30% | 86 | 125.8 | 24572 | 39.3 | 28.2 | 55.0 | 12.5 | 1.000 | 39739 | 0.4 / 2.4 | 0 | 0.472 | 1.001 | 0.473 ± 0.04 |

#### G2. Self-feeding through a keyed handshake (N = 6) (mean of 6 games of 600 rounds; too slow: total)

| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| handshake, greedy bee | 119 | 0.8 | 146395 | 32.7 | 30.0 | 47.7 | 20.8 | 0.263 | 46295 | 0.8 / 1.8 | 0 | 0.996 | 1.101 | 1.097 ± 0.04 |
| handshake, self-only bee | 120 | 0.8 | 146236 | 34.8 | 30.0 | 37.8 | 37.8 | 0.000 | 0 | 0.2 / 0.7 | 0 | 1.205 | 0.492 | 0.593 ± 0.02 |
| handshake, naive bee | 121 | 0.8 | 146099 | 24.8 | 30.0 | 55.0 | 6.7 | 1.000 | 46051 | 0.2 / 1.0 | 0 | 0.794 | 1.182 | 0.939 ± 0.04 |
| no handshake, greedy bee | 36 | 0.6 | 158919 | 31.8 | 30.0 | 48.3 | 18.8 | 0.298 | 45460 | 0.7 / 1.7 | 0 | 1.062 | 1.045 | 1.110 ± 0.04 |
| no handshake, naive bee | 36 | 0.6 | 158925 | 27.5 | 30.0 | 55.0 | 9.0 | 1.000 | 45386 | 0.2 / 1.3 | 0 | 0.921 | 1.138 | 1.048 ± 0.04 |
| no handshake, greedy bee | 36 | 0.6 | 158922 | 27.8 | 30.0 | 48.3 | 19.5 | 0.294 | 45402 | 0.8 / 1.7 | 0 | 1.022 | 1.041 | 1.065 ± 0.05 |

#### G3a. Reputation by signal: generous, average and stingy flowers with their own rules (N = 6) (mean of 6 games of 600 rounds; too slow: total)

| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 60%, greedy bee | 33 | 0.6 | 159364 | 52.3 | 60.0 | 47.2 | 20.7 | 0.251 | 73948 | 0.7 / 1.5 | 0 | 1.030 | 1.001 | 1.031 ± 0.03 |
| 60%, naive bee | 34 | 0.6 | 159217 | 58.2 | 60.0 | 55.0 | 7.8 | 1.000 | 40657 | 0.2 / 0.8 | 0 | 0.983 | 0.992 | 0.975 ± 0.05 |
| 30%, greedy bee | 35 | 0.6 | 159066 | 41.2 | 30.0 | 50.0 | 17.8 | 0.380 | 86641 | 0.7 / 1.5 | 0 | 1.206 | 1.012 | 1.220 ± 0.08 |
| 30%, naive bee | 36 | 0.6 | 158919 | 36.7 | 30.0 | 55.0 | 8.7 | 1.000 | 51533 | 0.2 / 0.6 | 0 | 1.074 | 1.008 | 1.082 ± 0.03 |
| 5%, greedy bee | 35 | 0.6 | 159069 | 29.8 | 5.0 | 50.5 | 14.8 | 0.443 | 79239 | 0.6 / 1.4 | 0 | 1.017 | 0.969 | 0.986 ± 0.05 |
| 5%, naive bee | 35 | 0.6 | 159062 | 17.2 | 5.0 | 55.0 | 7.5 | 1.000 | 58056 | 0.2 / 0.4 | 0 | 0.690 | 1.017 | 0.701 ± 0.06 |

#### G3b. The same, but team 4's stingy flower reads history and answers with the best-paying flower's rule (mean of 6 games of 600 rounds; too slow: total)

| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 60%, greedy bee | 33 | 0.7 | 159351 | 47.0 | 60.0 | 48.8 | 16.7 | 0.348 | 46361 | 0.7 / 1.8 | 0 | 0.910 | 0.992 | 0.903 ± 0.11 |
| 60%, naive bee | 34 | 0.7 | 159201 | 44.5 | 60.0 | 55.0 | 10.0 | 1.000 | 38921 | 0.2 / 0.8 | 0 | 0.841 | 1.015 | 0.854 ± 0.10 |
| 30%, greedy bee | 35 | 0.6 | 159062 | 41.8 | 30.0 | 48.7 | 19.7 | 0.310 | 69687 | 0.7 / 1.6 | 0 | 1.175 | 0.990 | 1.162 ± 0.06 |
| 30%, naive bee | 36 | 0.7 | 158904 | 35.0 | 30.0 | 55.0 | 9.3 | 1.000 | 47965 | 0.2 / 0.6 | 0 | 1.014 | 1.009 | 1.023 ± 0.03 |
| 5% MIMIC of the best-paying rule, greedy bee | 242 | 1.1 | 127757 | 42.3 | 5.0 | 49.2 | 12.5 | 0.391 | 76791 | 0.7 / 1.4 | 0 | 1.166 | 0.992 | 1.156 ± 0.05 |
| 5%, naive bee | 35 | 0.7 | 159054 | 21.8 | 5.0 | 55.0 | 11.0 | 1.000 | 58954 | 0.2 / 0.4 | 0 | 0.895 | 1.003 | 0.899 ± 0.09 |

#### G4. Team 0's percent to rival bees, against five teams at 30% (all: handshake, greedy bee, own rule; N = 6; mean of 6 games of 600 rounds)

| team 0's % to rivals | rival feeds at team 0 | team 0 pollination ×N | team 0 forage ×N | team 0 fitness | others' mean fitness |
|---|---|---|---|---|---|
| 5 | 1.3 | 0.422 | 0.963 | 0.407 ± 0.04 | 1.124 |
| 15 | 10.0 | 0.767 | 1.015 | 0.778 ± 0.02 | 1.044 |
| 30 | 28.7 | 1.012 | 0.998 | 1.010 ± 0.04 | 0.998 |
| 50 | 45.0 | 1.087 | 0.975 | 1.060 ± 0.03 | 0.988 |
| 70 | 60.5 | 1.065 | 0.936 | 0.997 ± 0.02 | 1.000 |

#### G5. A 10-minute game (3,000 rounds): bees rebuild their state from the whole history on every call (one game, 7112 actions)

| team | flower size | flower ms (p50) | E (p50) | rival feeds at it | % to rivals | bee feeds | self-feeds | bee's rival feed rate | nectar / rival feed | bee ms p50 / p99 | too slow | pollination ×N | forage ×N | fitness |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| handshake, greedy bee 0 | 119 | 0.8 | 146412 | 144.0 | 30.0 | 241.0 | 96.0 | 0.291 | 43807 | 2.3 / 6.7 | 0 | 0.998 | 1.000 | 0.998 |
| handshake, greedy bee 1 | 120 | 0.8 | 146247 | 147.0 | 30.0 | 243.0 | 97.0 | 0.305 | 43815 | 2.3 / 5.9 | 0 | 1.007 | 1.004 | 1.010 |
| handshake, greedy bee 2 | 121 | 0.8 | 146094 | 145.0 | 30.0 | 246.0 | 98.0 | 0.333 | 43823 | 2.1 / 5.9 | 0 | 1.002 | 1.010 | 1.012 |
| handshake, greedy bee 3 | 122 | 0.8 | 145948 | 146.0 | 30.0 | 240.0 | 96.0 | 0.282 | 43835 | 2.3 / 6.0 | 0 | 1.002 | 0.997 | 0.999 |
| handshake, greedy bee 4 | 122 | 0.8 | 145940 | 144.0 | 30.0 | 245.0 | 98.0 | 0.321 | 43832 | 2.4 / 5.9 | 0 | 0.999 | 1.008 | 1.006 |
| handshake, greedy bee 5 | 122 | 0.8 | 145940 | 145.0 | 30.0 | 232.0 | 91.0 | 0.239 | 43834 | 2.4 / 6.6 | 0 | 0.993 | 0.982 | 0.975 |

