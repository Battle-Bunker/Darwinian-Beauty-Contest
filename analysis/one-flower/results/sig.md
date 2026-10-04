### Change costs (node edits; flower budget 220 a minute, banked up to 220, from zero at the start)

| change | cost (nodes) | budget time at 220/min |
|---|---|---|
| rule: change its constant K (copy a parametric signal) | 4 | 1 s |
| rule: change its percent 30 → 5 | 2 | 1 s |
| rule → runtime mimic (reads history, copies the best-paying rule) | 209 | 57 s |
| rule → rotating rule (new K every T rounds) | 58 | 16 s |
| rule → keyed handshake + rule | 86 | 23 s |
| rule → RSA-512 signing flower | 298 | 81 s (over the cap: in steps) |
| RSA-512 flower → a new RSA-512 key (rotate the key) | 121 | 33 s |

### Signing flowers (int → graph[any]; 50 calls each on the real runner)

| modulus | flower size | ms (p50) | E (p50) | E / E of an 11-node flower | Pollard rho in pure Python (extrapolated) |
|---|---|---|---|---|---|
| 128 bits | 195 | 0.68 | 135137 | 0.83 | 53 min |
| 256 bits | 233 | 0.77 | 129387 | 0.80 | 4e+5 years |
| 512 bits | 309 | 1.27 | 117650 | 0.72 | 8e+24 years |
| 1024 bits | 464 | 4.19 | 92735 | 0.57 | 3e+63 years |

Pollard rho, measured (median CPU s): 40 bits 0.000, 48 bits 0.002, 56 bits 0.006, 64 bits 0.049, 72 bits 0.249. It scales as 2^(bits/4); quadratic-sieve tools are much faster above ~100 bits (a 256-bit modulus falls in minutes to msieve or YAFU), so the extrapolation is an upper bound for a team with real tools.
