# Sensitivity of the integrated fingerprint to the cooperators' mandate

Measured on the game machine (idle), the integrated flower (410 nodes, 85 bytes), one fresh challenge per call.
Energy is (1100 − size) × (R − CPU ms) × (1024 − bytes); a 40-node veteran is taken to use 0.6 ms of CPU.
Blind feeding at a veteran pays, per feed: 15% at 50 bytes 11.8M; 15% at 170 bytes 10.3M;
25% at 50 bytes 19.6M; 25% at 170 bytes 17.2M.

## How readable the profile and the wealth are, by burn

| burn | profile read right (5 weightings) at R = 3 / 20 / 76 / 150 | median error reading R back at R = 20 / 76 | U at R = 3 / 20 / 76 / 150 |
|---|---|---|---|
| 30% | 0.37 / 0.72 / 0.91 / 0.85 | 0.16 / 0.30 | 2.1 / 13.6 / 17.1 / 18.1 |
| 45% | 0.47 / 0.85 / 0.89 / 0.95 | 0.08 / 0.41 | 6.5 / 14.9 / 18.1 / 18.7 |
| 60% | 0.60 / 0.89 / 0.88 / 0.87 | 0.18 / 0.26 | 8.5 / 15.9 / 18.3 / 19.1 |

## Nectar, by burn and nectar share

Columns per veteran case:
- R*: the R above which a cooperator turn beats blind feeding at that veteran
- above: the share of cooperator turns above R*
- bee: what a bee feeding on its own reading of R from U gets per feed, and the share of turns it feeds

| burn | nectar | cooperator per feed, all turns | vs 15%, 50 B: R* / above / bee | vs 25%, 50 B: R* / above / bee | vs 25%, 170 B: R* / above / bee |
|---|---|---|---|---|---|
| 30% | 50% | 17.5M | 52 ms / 65% / 21.8M at 70% | 87 ms / 46% / 24.6M at 39% | 76 ms / 51% / 24.3M at 43% |
| 30% | 65% | 22.8M | 41 ms / 74% / 27.2M at 78% | 68 ms / 57% / 31.1M at 55% | 59 ms / 62% / 30.0M at 62% |
| 30% | 80% | 28.0M | 33 ms / 80% / 32.7M at 82% | 55 ms / 64% / 35.6M at 67% | 48 ms / 68% / 34.3M at 73% |
| 45% | 50% | 13.8M | 66 ms / 58% / 18.0M at 53% | 110 ms / 28% / 19.8M at 33% | 96 ms / 38% / 19.8M at 35% |
| 45% | 65% | 17.9M | 51 ms / 65% / 22.0M at 71% | 85 ms / 47% / 25.1M at 38% | 76 ms / 51% / 24.5M at 42% |
| 45% | 80% | 22.0M | 43 ms / 72% / 26.2M at 78% | 69 ms / 55% / 29.3M at 47% | 61 ms / 61% / 28.0M at 61% |
| 60% | 50% | 10.0M | 91 ms / 42% / 13.4M at 36% | never / 0% / – at 0% | 133 ms / 13% / 13.9M at 25% |
| 60% | 65% | 13.0M | 70 ms / 54% / 17.2M at 46% | 117 ms / 25% / 18.0M at 30% | 103 ms / 33% / 17.7M at 33% |
| 60% | 80% | 16.0M | 57 ms / 63% / 20.4M at 58% | 95 ms / 39% / 21.6M at 34% | 83 ms / 48% / 21.4M at 38% |
