## CPU-time noise of identical work, and misses (2 slots)

| condition | work | CPU p50 ms | ÷ idle | CPU CV % | CPU p5 | CPU p95 | CPU max | wall p50 | wall p95 |
|---|---|---|---|---|---|---|---|---|---|
| idle1slot | interp | 25.56 | 0.981 | 16.9 | 24.78 | 31.13 | 49.85 | 26.73 | 32.56 |
| idle1slot | memory | 27.10 | 0.935 | 16.0 | 24.98 | 32.33 | 50.71 | 28.28 | 33.33 |
| idle | interp | 26.06 | 1.000 | 19.4 | 25.20 | 41.44 | 48.47 | 27.52 | 42.91 |
| idle | memory | 28.97 | 1.000 | 21.7 | 27.31 | 50.07 | 53.92 | 30.75 | 52.73 |
| autogroup | interp | 26.75 | 1.026 | 15.3 | 25.20 | 34.57 | 52.67 | 117.74 | 171.15 |
| autogroup | memory | 29.33 | 1.012 | 14.9 | 27.72 | 35.49 | 52.65 | 116.10 | 163.83 |
| agnice | interp | 26.26 | 1.008 | 8.8 | 25.31 | 32.08 | 39.05 | 28.98 | 65.18 |
| agnice | memory | 28.49 | 0.983 | 10.7 | 27.03 | 37.44 | 41.18 | 30.55 | 65.67 |
| cpuidle | interp | 25.79 | 0.990 | 19.2 | 25.01 | 39.42 | 49.27 | 28.13 | 48.82 |
| cpuidle | memory | 29.03 | 1.002 | 26.1 | 26.89 | 52.34 | 55.65 | 31.70 | 66.31 |
| cpuset | interp | 25.54 | 0.980 | 11.4 | 24.94 | 28.92 | 44.58 | 27.74 | 50.50 |
| cpuset | memory | 28.58 | 0.986 | 17.0 | 27.36 | 38.70 | 51.12 | 30.78 | 51.10 |
| fifo | interp | 25.26 | 0.969 | 9.6 | 24.84 | 28.03 | 40.33 | 26.38 | 31.04 |
| fifo | memory | 27.53 | 0.950 | 17.2 | 26.68 | 31.77 | 54.93 | 28.77 | 36.09 |
| contained | interp | 26.11 | 1.002 | 13.6 | 25.26 | 30.13 | 45.88 | 28.02 | 47.84 |
| contained | memory | 28.24 | 0.975 | 12.3 | 26.83 | 32.89 | 47.06 | 30.45 | 50.63 |

| condition | 0.9R burner, wall limit R: late | bee 40 ms CPU, 50 ms wall: late | 0.9R burner, CPU limit R: late | CPU-limit burner wall ÷ R, p95 |
|---|---|---|---|---|
| idle1slot | 0.0% of 30 | 0.0% of 30 | 0.0% of 30 | 2.47 |
| idle | 0.0% of 60 | 0.0% of 60 | 0.0% of 60 | 1.13 |
| autogroup | 100.0% of 60 | 98.3% of 60 | 3.3% of 60 | 6.02 |
| agnice | 38.3% of 60 | 33.3% of 60 | 1.7% of 60 | 1.75 |
| cpuidle | 11.7% of 60 | 10.0% of 60 | 0.0% of 60 | 1.32 |
| cpuset | 18.3% of 60 | 16.7% of 60 | 0.0% of 60 | 1.37 |
| fifo | 0.0% of 60 | 0.0% of 60 | 0.0% of 60 | 1.18 |
| contained | 16.7% of 60 | 6.7% of 60 | 1.7% of 60 | 1.39 |

## Stop precision: CPU at the stop − (CPU at arming + R), ms

- controls (idle): an exit costs 0.389 ms of CPU, 0.582 ms with a perf event open

- controls (autogroup): an exit costs 0.440 ms of CPU, 0.435 ms with a perf event open

- controls (cpuidle): an exit costs 0.332 ms of CPU, 0.535 ms with a perf event open

- controls (cpuset): an exit costs 0.436 ms of CPU, 0.410 ms with a perf event open

- controls (contained): an exit costs 0.381 ms of CPU, 0.330 ms with a perf event open

### workload: py

| condition | mechanism | over p50 | over p95 | min | max | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|
| idle | real | 0.062 | 0.115 | -3.029 | 0.139 | 3:0.07 10:0.09 50:-0.03 150:-0.83 | 1.07 | caught:60 |
| idle | prof | 3.286 | 5.624 | 1.348 | 6.242 | 3:2.51 10:4.14 50:3.29 150:3.41 | 1.32 | caught:60 |
| idle | virtual | 3.881 | 9.534 | 1.416 | 13.502 | 3:2.96 10:3.55 50:5.46 150:6.37 | 1.30 | caught:60 |
| idle | posix | 2.550 | 3.961 | 0.193 | 4.083 | 3:2.64 10:2.55 50:3.06 150:1.95 | 1.17 | caught:60 |
| idle | prof_kill | -0.356 | 1.470 | -2.925 | 2.106 | 3:-1.16 10:-0.01 50:-0.68 150:-0.49 | 1.31 | died:60 |
| idle | rearm | 0.049 | 0.097 | -0.069 | 0.108 | 3:0.05 10:0.08 50:0.06 150:0.01 | 1.08 | caught:60 |
| idle | watchdog | 0.202 | 0.320 | 0.025 | 0.449 | 3:0.21 10:0.22 50:0.20 150:0.16 | 1.08 | killed:60 |
| idle | schedstat | 0.341 | 0.480 | 0.058 | 0.603 | 3:0.28 10:0.38 50:0.34 150:0.28 | 1.09 | killed:60 |
| idle | watchdog_perf | 0.229 | 0.340 | -12.384 | 1.506 | 3:0.24 10:0.25 50:0.21 150:-0.18 | 1.07 | killed:60 |
| idle | watchdog_rt | 0.179 | 0.302 | -3.609 | 1.437 | 3:0.17 10:0.21 50:0.19 150:-1.56 | 1.08 | killed:60 |
| idle | perf_kill | -0.003 | 3.006 | -32.410 | 148.124 | 3:0.01 10:0.00 50:-0.10 150:-0.12 | 1.07 | died:60 |
| idle | perf_sigtrap | -0.013 | 49.848 | -20.979 | 147.446 | 3:-0.01 10:-0.01 50:-0.01 150:-0.62 | 1.09 | died:60 |
| autogroup | real | -3.993 | 0.023 | -80.981 | 0.085 | 3:-0.02 10:-1.55 50:-18.96 150:-42.85 | 1.08 | caught:60 |
| autogroup | prof | 4.131 | 8.697 | -2.838 | 18.295 | 3:3.37 10:5.15 50:5.50 150:3.51 | 2.15 | caught:60 |
| autogroup | virtual | 4.188 | 14.609 | -3.268 | 23.912 | 3:4.07 10:3.79 50:4.72 150:11.89 | 1.88 | caught:60 |
| autogroup | posix | 2.331 | 4.057 | 0.103 | 6.191 | 3:2.44 10:2.05 50:1.78 150:2.43 | 2.04 | caught:60 |
| autogroup | prof_kill | 0.150 | 5.665 | -7.507 | 7.096 | 3:0.16 10:0.15 50:0.34 150:-0.45 | 2.19 | died:60 |
| autogroup | rearm | -0.008 | 0.039 | -0.073 | 0.069 | 3:-0.01 10:-0.01 50:-0.01 150:-0.00 | 1.48 | caught:60 |
| autogroup | watchdog | 0.037 | 0.050 | -0.020 | 0.505 | 3:0.04 10:0.04 50:0.04 150:0.04 | 1.31 | killed:60 |
| autogroup | schedstat | 0.038 | 0.828 | -0.003 | 1.457 | 3:0.03 10:0.04 50:0.04 150:0.05 | 1.66 | killed:60 |
| autogroup | watchdog_perf | 0.007 | 0.920 | -10.974 | 1.453 | 3:0.04 10:0.01 50:0.02 150:-0.19 | 1.50 | killed:60 |
| autogroup | watchdog_rt | -0.057 | 0.141 | -3.108 | 0.165 | 3:-0.00 10:-0.04 50:-0.24 150:-0.38 | 1.23 | killed:60 |
| autogroup | perf_kill | -0.029 | 9.986 | -2.569 | 149.178 | 3:0.00 10:0.00 50:-0.08 150:-0.43 | 1.49 | died:60 |
| autogroup | perf_sigtrap | -0.035 | 0.008 | -2.541 | 149.659 | 3:-0.01 10:-0.02 50:-0.24 150:-0.27 | 1.62 | died:60 |
| cpuidle | real | 0.008 | 0.098 | -6.929 | 0.113 | 3:0.03 10:0.08 50:-0.10 150:-0.23 | 1.07 | caught:60 |
| cpuidle | prof | 3.442 | 5.630 | 0.613 | 5.848 | 3:2.68 10:3.96 50:4.07 150:2.56 | 1.35 | caught:60 |
| cpuidle | virtual | 3.785 | 9.412 | -1.814 | 12.011 | 3:3.23 10:3.69 50:3.86 150:3.74 | 1.33 | caught:60 |
| cpuidle | posix | 2.445 | 3.657 | 0.111 | 3.992 | 3:2.63 10:1.11 50:2.89 150:2.29 | 1.13 | caught:60 |
| cpuidle | prof_kill | -0.244 | 1.977 | -2.924 | 4.932 | 3:-1.67 10:-0.24 50:0.16 150:-0.62 | 1.40 | died:60 |
| cpuidle | rearm | 0.019 | 0.079 | -0.045 | 0.086 | 3:0.05 10:0.02 50:0.02 150:0.00 | 1.07 | caught:60 |
| cpuidle | watchdog | 0.158 | 0.276 | 0.003 | 0.296 | 3:0.16 10:0.11 50:0.12 150:0.18 | 1.06 | killed:60 |
| cpuidle | schedstat | 0.242 | 0.438 | 0.009 | 1.054 | 3:0.25 10:0.25 50:0.30 150:0.17 | 1.09 | killed:60 |
| cpuidle | watchdog_perf | 0.178 | 0.296 | -5.866 | 0.393 | 3:0.21 10:0.20 50:0.16 150:0.02 | 1.08 | killed:60 |
| cpuidle | watchdog_rt | 0.000 | 0.218 | -6.625 | 0.281 | 3:-0.00 10:0.10 50:0.03 150:-0.39 | 1.07 | killed:60 |
| cpuidle | perf_kill | 0.002 | 0.037 | -7.343 | 49.938 | 3:0.00 10:0.00 50:-0.01 150:-0.08 | 1.07 | died:60 |
| cpuidle | perf_sigtrap | -0.022 | -0.007 | -4.212 | 146.926 | 3:-0.01 10:-0.01 50:-0.10 150:-0.15 | 1.09 | died:60 |
| cpuset | real | -0.022 | 0.095 | -19.917 | 0.178 | 3:0.07 10:0.07 50:-0.93 150:-2.62 | 1.07 | caught:60 |
| cpuset | prof | 3.358 | 5.436 | -0.007 | 7.549 | 3:2.88 10:3.95 50:3.47 150:3.01 | 1.28 | caught:60 |
| cpuset | virtual | 3.652 | 10.253 | 1.392 | 12.112 | 3:2.49 10:3.65 50:4.13 150:5.66 | 1.30 | caught:60 |
| cpuset | posix | 2.117 | 3.673 | 0.150 | 4.079 | 3:2.12 10:2.32 50:2.07 150:1.93 | 1.16 | caught:60 |
| cpuset | prof_kill | -0.649 | 1.551 | -3.194 | 3.175 | 3:-1.89 10:-0.33 50:-0.57 150:-0.93 | 1.30 | died:60 |
| cpuset | rearm | 0.015 | 0.071 | -0.056 | 0.112 | 3:0.05 10:0.05 50:0.00 150:0.01 | 1.07 | caught:60 |
| cpuset | watchdog | 0.192 | 0.331 | 0.017 | 0.397 | 3:0.20 10:0.21 50:0.14 150:0.17 | 1.08 | killed:60 |
| cpuset | schedstat | 0.279 | 0.461 | -0.015 | 0.559 | 3:0.27 10:0.32 50:0.25 150:0.22 | 1.09 | killed:60 |
| cpuset | watchdog_perf | 0.197 | 0.335 | -8.392 | 0.635 | 3:0.21 10:0.22 50:0.19 150:-0.26 | 1.08 | killed:60 |
| cpuset | watchdog_rt | 0.166 | 0.296 | -8.577 | 0.349 | 3:0.18 10:0.20 50:0.05 150:0.09 | 1.08 | killed:60 |
| cpuset | perf_kill | 0.001 | 9.827 | -4.812 | 95.315 | 3:0.00 10:0.00 50:-0.09 150:-0.34 | 1.07 | died:60 |
| cpuset | perf_sigtrap | -0.074 | -0.009 | -8.536 | 9.406 | 3:-0.01 10:-0.02 50:-0.12 150:-0.30 | 1.08 | died:60 |
| contained | real | 0.006 | 0.093 | -6.459 | 0.097 | 3:0.06 10:0.04 50:-0.08 150:-0.35 | 1.07 | caught:60 |
| contained | prof | 3.477 | 5.601 | 1.278 | 5.885 | 3:3.06 10:4.35 50:3.30 150:3.50 | 1.38 | caught:60 |
| contained | virtual | 4.083 | 10.582 | 1.142 | 11.071 | 3:2.60 10:3.51 50:4.26 150:6.95 | 1.29 | caught:60 |
| contained | posix | 2.374 | 3.823 | 0.174 | 4.064 | 3:2.52 10:2.36 50:2.45 150:1.88 | 1.19 | caught:60 |
| contained | prof_kill | -0.728 | 1.151 | -3.039 | 2.111 | 3:-1.80 10:-0.39 50:-0.14 150:-0.15 | 1.30 | died:60 |
| contained | rearm | 0.035 | 0.081 | -0.080 | 0.115 | 3:0.05 10:0.07 50:0.03 150:-0.00 | 1.08 | caught:60 |
| contained | watchdog | 0.206 | 0.337 | 0.020 | 0.444 | 3:0.21 10:0.23 50:0.17 150:0.21 | 1.08 | killed:60 |
| contained | schedstat | 0.342 | 0.488 | 0.045 | 0.760 | 3:0.31 10:0.36 50:0.28 150:0.36 | 1.09 | killed:60 |
| contained | watchdog_perf | 0.207 | 0.552 | -3.222 | 1.135 | 3:0.23 10:0.21 50:0.11 150:0.09 | 1.07 | killed:60 |
| contained | watchdog_rt | 0.184 | 0.320 | -6.503 | 0.756 | 3:0.18 10:0.23 50:0.20 150:-0.75 | 1.08 | killed:60 |
| contained | perf_kill | -0.051 | 0.008 | -11.825 | 10.004 | 3:0.00 10:0.00 50:-0.07 150:-0.25 | 1.07 | died:60 |
| contained | perf_sigtrap | -0.037 | -0.009 | -6.810 | 99.898 | 3:-0.01 10:-0.02 50:-0.05 150:-0.76 | 1.09 | died:60 |

### workload: c

| condition | mechanism | over p50 | over p95 | min | max | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|
| idle | real | 93.053 | 157.255 | 51.109 | 169.313 | 3:104.71 10:157.25 50:79.52 150:78.79 | 10.29 | caught:16 |
| idle | prof | 93.153 | 131.244 | 51.990 | 141.403 | 3:119.23 10:93.70 50:52.63 150:61.44 | 10.17 | caught:16 |
| idle | virtual | 93.462 | 165.830 | 51.057 | 168.000 | 3:102.83 10:99.18 50:53.51 150:60.88 | 10.49 | caught:16 |
| idle | posix | 94.136 | 101.782 | 54.843 | 122.609 | 3:101.70 10:97.52 50:63.42 150:92.43 | 10.33 | caught:16 |
| idle | prof_kill | 3.522 | 4.929 | 1.685 | 5.936 | 3:3.52 10:3.86 50:3.76 150:3.41 | 1.31 | died:16 |
| idle | rearm | 94.569 | 126.052 | 51.267 | 133.187 | 3:100.70 10:101.34 50:58.14 150:72.39 | 10.56 | caught:16 |
| idle | watchdog | 3.738 | 4.148 | 2.728 | 4.495 | 3:3.74 10:3.94 50:3.73 150:4.03 | 1.33 | killed:16 |
| idle | schedstat | 3.579 | 4.396 | 0.691 | 4.792 | 3:3.88 10:3.58 50:4.23 150:3.81 | 1.13 | killed:16 |
| idle | watchdog_perf | 0.063 | 0.454 | -1.597 | 0.469 | 3:0.06 10:0.45 50:0.15 150:0.19 | 1.09 | killed:16 |
| idle | watchdog_rt | 0.144 | 0.496 | -3.389 | 0.988 | 3:0.00 10:0.24 50:0.26 150:0.37 | 1.08 | killed:16 |
| idle | perf_kill | -0.041 | 0.071 | -3.568 | 0.280 | 3:-0.04 10:-0.03 50:0.02 150:-0.18 | 1.07 | died:16 |
| idle | perf_sigtrap | -0.110 | 0.007 | -4.427 | 0.014 | 3:-0.11 10:-0.06 50:-0.06 150:-0.00 | 1.09 | died:16 |
| autogroup | real | 97.840 | 107.958 | -44.817 | 110.600 | 3:104.44 10:99.93 50:62.56 150:66.10 | 11.15 | caught:16 |
| autogroup | prof | 94.911 | 106.893 | 55.388 | 108.494 | 3:106.37 10:100.41 50:60.50 150:62.57 | 13.38 | caught:16 |
| autogroup | virtual | 95.381 | 106.180 | 55.579 | 135.227 | 3:105.82 10:97.14 50:56.62 150:70.72 | 10.79 | caught:16 |
| autogroup | posix | 94.447 | 104.470 | 9.451 | 106.951 | 3:104.47 10:100.23 50:61.63 150:62.27 | 10.73 | caught:16 |
| autogroup | prof_kill | 4.344 | 9.066 | 1.812 | 15.315 | 3:4.11 10:4.34 50:5.09 150:9.07 | 2.09 | died:16 |
| autogroup | rearm | 94.684 | 159.022 | 57.031 | 220.294 | 3:159.02 10:107.90 50:65.72 150:63.40 | 13.52 | caught:16 |
| autogroup | watchdog | 0.120 | 0.982 | 0.039 | 3.401 | 3:0.98 10:0.11 50:0.12 150:0.14 | 1.67 | killed:16 |
| autogroup | schedstat | 0.146 | 3.697 | -0.008 | 3.983 | 3:0.15 10:0.15 50:0.15 150:0.13 | 1.65 | killed:16 |
| autogroup | watchdog_perf | 0.054 | 0.482 | -11.460 | 3.991 | 3:-0.03 10:0.06 50:0.17 150:-0.14 | 1.52 | killed:16 |
| autogroup | watchdog_rt | -0.059 | 0.357 | -0.373 | 0.482 | 3:-0.09 10:0.36 50:-0.12 150:-0.06 | 1.58 | killed:16 |
| autogroup | perf_kill | 0.025 | 0.141 | -5.983 | 0.672 | 3:0.03 10:0.14 50:0.03 150:-1.52 | 1.69 | died:16 |
| autogroup | perf_sigtrap | 0.005 | 0.136 | -2.521 | 3.135 | 3:0.07 10:0.06 50:0.01 150:-0.01 | 1.57 | died:16 |
| cpuidle | real | 95.286 | 122.658 | 54.135 | 146.778 | 3:115.35 10:111.52 50:57.17 150:67.28 | 11.01 | caught:16 |
| cpuidle | prof | 95.545 | 137.230 | 60.780 | 161.191 | 3:105.45 10:95.54 50:79.14 150:102.63 | 10.58 | caught:16 |
| cpuidle | virtual | 99.020 | 133.608 | 55.838 | 175.707 | 3:103.64 10:100.52 50:60.49 150:65.45 | 11.17 | caught:16 |
| cpuidle | posix | 96.877 | 106.633 | 58.145 | 170.850 | 3:102.56 10:103.80 50:95.45 150:65.81 | 10.62 | caught:16 |
| cpuidle | prof_kill | 3.853 | 5.260 | 1.604 | 6.577 | 3:3.13 10:4.01 50:4.26 150:4.07 | 1.35 | died:16 |
| cpuidle | rearm | 98.998 | 105.391 | 54.436 | 113.251 | 3:104.64 10:99.00 50:60.72 150:72.70 | 10.65 | caught:16 |
| cpuidle | watchdog | 3.483 | 4.174 | 0.276 | 4.178 | 3:3.86 10:4.09 50:3.58 150:3.34 | 1.28 | killed:16 |
| cpuidle | schedstat | 3.589 | 4.353 | 0.507 | 4.645 | 3:3.16 10:4.35 50:3.62 150:3.87 | 1.11 | killed:16 |
| cpuidle | watchdog_perf | 0.281 | 0.613 | -2.758 | 0.982 | 3:0.28 10:0.35 50:0.46 150:0.28 | 1.08 | killed:16 |
| cpuidle | watchdog_rt | 0.052 | 0.244 | -0.837 | 0.261 | 3:0.05 10:0.16 50:0.20 150:-0.04 | 1.08 | killed:16 |
| cpuidle | perf_kill | -0.039 | 0.121 | -1.079 | 0.571 | 3:0.01 10:0.00 50:-0.04 150:-0.36 | 1.06 | died:16 |
| cpuidle | perf_sigtrap | -0.071 | 0.104 | -1.873 | 0.531 | 3:-0.07 10:0.03 50:-0.02 150:-0.05 | 1.09 | died:16 |
| cpuset | real | 101.003 | 137.015 | 56.077 | 141.920 | 3:117.25 10:101.00 50:111.40 150:61.74 | 10.84 | caught:16 |
| cpuset | prof | 101.669 | 121.571 | 55.717 | 150.450 | 3:104.64 10:106.86 50:76.75 150:68.79 | 11.19 | caught:16 |
| cpuset | virtual | 95.481 | 113.767 | 26.671 | 169.935 | 3:112.23 10:104.69 50:57.03 150:62.70 | 10.71 | caught:16 |
| cpuset | posix | 96.680 | 111.060 | 58.212 | 115.556 | 3:104.67 10:97.20 50:67.50 150:70.66 | 10.78 | caught:16 |
| cpuset | prof_kill | 3.764 | 5.777 | 1.971 | 6.181 | 3:3.76 10:3.90 50:3.58 150:5.41 | 1.38 | died:16 |
| cpuset | rearm | 102.985 | 136.456 | 55.086 | 137.038 | 3:105.04 10:102.98 50:57.62 150:62.37 | 11.04 | caught:16 |
| cpuset | watchdog | 3.531 | 4.048 | 0.363 | 4.379 | 3:3.89 10:3.98 50:3.53 150:3.22 | 1.14 | killed:16 |
| cpuset | schedstat | 3.888 | 4.208 | 0.594 | 4.344 | 3:3.54 10:3.89 50:4.17 150:3.91 | 1.35 | killed:16 |
| cpuset | watchdog_perf | 0.208 | 0.525 | -0.916 | 0.741 | 3:0.21 10:0.35 50:0.37 150:0.13 | 1.08 | killed:16 |
| cpuset | watchdog_rt | 0.194 | 0.344 | -2.871 | 0.511 | 3:0.19 10:0.28 50:-0.36 150:0.27 | 1.07 | killed:16 |
| cpuset | perf_kill | 0.117 | 0.544 | -1.840 | 0.568 | 3:0.07 10:0.20 50:0.17 150:0.24 | 1.05 | died:16 |
| cpuset | perf_sigtrap | 0.057 | 0.172 | -5.784 | 0.319 | 3:0.06 10:0.10 50:0.11 150:-1.43 | 1.08 | died:16 |
| contained | real | 94.075 | 107.829 | 54.102 | 115.088 | 3:107.83 10:96.28 50:56.37 150:66.12 | 10.28 | caught:16 |
| contained | prof | 92.589 | 113.474 | 51.735 | 118.147 | 3:110.80 10:103.34 50:52.65 150:60.29 | 10.50 | caught:16 |
| contained | virtual | 91.157 | 99.404 | 51.970 | 110.109 | 3:99.40 10:91.89 50:53.28 150:61.45 | 10.22 | caught:16 |
| contained | posix | 92.190 | 116.356 | 50.837 | 145.190 | 3:109.04 10:92.50 50:56.63 150:66.46 | 10.25 | caught:16 |
| contained | prof_kill | 3.741 | 5.491 | 1.895 | 5.952 | 3:3.74 10:3.26 50:4.58 150:4.63 | 1.30 | died:16 |
| contained | rearm | 96.316 | 133.693 | 16.809 | 168.173 | 3:101.01 10:107.31 50:70.16 150:57.95 | 10.43 | caught:16 |
| contained | watchdog | 3.406 | 4.171 | 0.402 | 4.277 | 3:3.52 10:3.62 50:4.17 150:2.60 | 1.29 | killed:16 |
| contained | schedstat | 3.843 | 4.213 | 0.682 | 4.397 | 3:3.50 10:4.18 50:4.02 150:3.87 | 1.37 | killed:16 |
| contained | watchdog_perf | 0.417 | 0.886 | -1.413 | 1.629 | 3:0.37 10:0.49 50:0.89 150:0.30 | 1.08 | killed:16 |
| contained | watchdog_rt | 0.344 | 0.766 | -1.790 | 0.791 | 3:0.26 10:0.77 50:0.42 150:0.53 | 1.08 | killed:16 |
| contained | perf_kill | 0.164 | 0.334 | -0.173 | 0.346 | 3:0.16 10:0.20 50:0.33 150:0.01 | 1.07 | died:16 |
| contained | perf_sigtrap | 0.069 | 0.216 | -5.166 | 0.258 | 3:0.11 10:0.20 50:0.22 150:-1.60 | 1.09 | died:16 |

Arming cost (idle, us, p50): perf_kill 249.4, perf_sigtrap 215.2, posix 302.9, prof 34.9, prof_kill 42.9, real 40.0, rearm 79.9, schedstat 0.0, virtual 34.6, watchdog 0.0, watchdog_perf 221.9, watchdog_rt 218.2

Watchdog wake-ups per call (p50/max): autogroup/schedstat 2/64, autogroup/watchdog 2/8, autogroup/watchdog_perf 3/12, autogroup/watchdog_rt 2/54, contained/schedstat 1/10, contained/watchdog 1/12, contained/watchdog_perf 1/1, contained/watchdog_rt 1/2, cpuidle/schedstat 1/7, cpuidle/watchdog 1/5, cpuidle/watchdog_perf 1/2, cpuidle/watchdog_rt 1/2, cpuset/schedstat 1/23, cpuset/watchdog 1/33, cpuset/watchdog_perf 1/5, cpuset/watchdog_rt 1/3, idle/schedstat 1/9, idle/watchdog 1/8, idle/watchdog_perf 1/1, idle/watchdog_rt 1/1

## TypeScript runner options: CPU at the stop − R (main or worker thread), ms

| condition | mechanism | over p50 | over p95 | min | max | p50 by R | wall÷R p50 | costs |
|---|---|---|---|---|---|---|---|---|
| idle | sigint_perf | -2.504 | 139.812 | -12.826 | 147.476 | 3:-0.50 10:-3.29 50:-0.98 150:-2.50 | 1.01 | arm 131 us |
| idle | sigint_poll | -0.045 | 1.672 | -0.947 | 1.962 | 3:-0.05 10:-0.95 50:-0.23 150:0.09 | 1.06 |  |
| idle | vm_wall | -0.210 | 1.966 | -6.407 | 2.006 | 3:1 10:-2.03 50:-2.00 150:0.72 | 1.06 |  |
| idle | worker_kill | -2.013 | 3.824 | -3 | 3.824 | 3:-3 10:-2.01 50:-0.04 150:-2.32 | 1.03 | terminate 2.2 ms, respawn 39.4 ms |
| autogroup | sigint_perf | -1.007 | 0.279 | -6.113 | 147.216 | 3:-0.80 10:-0.20 50:-1.90 150:-1.11 | 2.26 | arm 109 us |
| autogroup | sigint_poll | -0.437 | 4.333 | -6.547 | 6.195 | 3:0.02 10:-1.10 50:-0.73 150:-1.30 | 2.29 |  |
| autogroup | vm_wall | -7.656 | -0.324 | -114.812 | -0.005 | 3:-1.82 10:-6.67 50:-30.82 150:-73.27 | 1.11 |  |
| autogroup | worker_kill | -0.961 | 0.720 | -5.802 | 2.810 | 3:-0.99 10:-1.19 50:-1.29 150:-1.85 | 1.87 | terminate 2.2 ms, respawn 90.9 ms |

Fixed JS workload in fresh contexts (ms):

| condition | clock | p50 | CV % | p5 | p95 | max |
|---|---|---|---|---|---|---|
| idle | thread | 31.89 | 5.8 | 30.71 | 35.48 | 40.20 |
| idle | process | 38.05 | 5.1 | 36.57 | 41.72 | 45.12 |
| idle | wall | 32.44 | 6.4 | 31.11 | 37.36 | 39.24 |
| autogroup | thread | 31.93 | 11.5 | 28.19 | 39.30 | 43.97 |
| autogroup | process | 37.24 | 10.7 | 33.31 | 44.48 | 50.61 |
| autogroup | wall | 91.24 | 30.7 | 53.23 | 150.77 | 151.23 |

- worker.cpuUsage() while the worker computes (idle): 138 answers in 305 ms; the value changed 79 times, steps (ms) [3.97, 4.0, 4.69, 3.07, 4.0, 1.98, 1.99, 4.0, 1.07, 2.8, 4.0, 4.0]

- worker.cpuUsage() while the worker computes (autogroup): 101 answers in 317 ms; the value changed 95 times, steps (ms) [4.02, 1.83, 2.16, 1.48, 2.44, 3.8, 0.18, 3.18, 1.08, 2.58, 3.91, 4.0]

## Counting work units in Python

| condition | python | work | mode | CPU p50 ms | × native | units | across runs | ns of CPU per unit |
|---|---|---|---|---|---|---|---|---|
| idle | 3.11.15 | cbig | calls | 84.9 | 1.0 | 11 | identical | 7721055.9 |
| idle | 3.11.15 | cbig | lines | 84.0 | 1.0 | 2 | identical | 42016873.0 |
| idle | 3.11.15 | cbig | native | 87.8 | 1.0 | – | – | – |
| idle | 3.11.15 | cbig | opcodes | 82.6 | 0.9 | 26 | identical | 3176773.9 |
| idle | 3.11.15 | interp | calls | 68.0 | 2.4 | 221317 | identical | 307.0 |
| idle | 3.11.15 | interp | lines | 100.5 | 3.6 | 441657 | identical | 227.5 |
| idle | 3.11.15 | interp | native | 28.1 | 1.0 | – | – | – |
| idle | 3.11.15 | interp | opcodes | 440.6 | 15.7 | 2647575 | identical | 166.4 |
| idle | 3.11.15 | memory | calls | 49.5 | 1.7 | 140005 | identical | 353.3 |
| idle | 3.11.15 | memory | lines | 77.7 | 2.7 | 350008 | identical | 221.9 |
| idle | 3.11.15 | memory | native | 28.8 | 1.0 | – | – | – |
| idle | 3.11.15 | memory | opcodes | 385.5 | 13.4 | 2310030 | identical | 166.9 |
| idle | 3.12.3 | cbig | calls | 96.3 | 0.9 | 11 | identical | 8750806.3 |
| idle | 3.12.3 | cbig | lines | 90.3 | 0.8 | 2 | identical | 45131431.0 |
| idle | 3.12.3 | cbig | mon_branch | 91.3 | 0.8 | 2 | identical | 45656145.0 |
| idle | 3.12.3 | cbig | mon_instr | 103.0 | 1.0 | 30 | identical | 3432299.8 |
| idle | 3.12.3 | cbig | native | 108.3 | 1.0 | – | – | – |
| idle | 3.12.3 | cbig | opcodes | 94.0 | 0.9 | 0 | identical | – |
| idle | 3.12.3 | interp | calls | 70.1 | 2.3 | 221333 | identical | 316.8 |
| idle | 3.12.3 | interp | lines | 119.1 | 3.9 | 441682 | identical | 269.7 |
| idle | 3.12.3 | interp | mon_branch | 64.8 | 2.1 | 221105 | identical | 292.9 |
| idle | 3.12.3 | interp | mon_instr | 544.0 | 18.0 | 2537052 | identical | 214.4 |
| idle | 3.12.3 | interp | native | 30.3 | 1.0 | – | – | – |
| idle | 3.12.3 | interp | opcodes | 45.9 | 1.5 | 0 | identical | – |
| idle | 3.12.3 | memory | calls | 57.4 | 1.8 | 140005 | identical | 410.3 |
| idle | 3.12.3 | memory | lines | 106.9 | 3.4 | 350008 | identical | 305.3 |
| idle | 3.12.3 | memory | mon_branch | 70.1 | 2.2 | 280004 | identical | 250.4 |
| idle | 3.12.3 | memory | mon_instr | 524.8 | 16.6 | 2240036 | identical | 234.3 |
| idle | 3.12.3 | memory | native | 31.6 | 1.0 | – | – | – |
| idle | 3.12.3 | memory | opcodes | 44.2 | 1.4 | 0 | identical | – |
| idle | 3.13.14 | cbig | calls | 80.8 | 1.0 | 11 | identical | 7345240.5 |
| idle | 3.13.14 | cbig | lines | 82.8 | 1.0 | 2 | identical | 41404789.0 |
| idle | 3.13.14 | cbig | mon_branch | 89.4 | 1.1 | 2 | identical | 44684401.5 |
| idle | 3.13.14 | cbig | mon_instr | 83.9 | 1.0 | 30 | identical | 2798209.6 |
| idle | 3.13.14 | cbig | native | 82.6 | 1.0 | – | – | – |
| idle | 3.13.14 | cbig | opcodes | 86.7 | 1.1 | 0 | identical | – |
| idle | 3.13.14 | interp | calls | 80.4 | 2.8 | 221333 | identical | 363.2 |
| idle | 3.13.14 | interp | lines | 81.0 | 2.8 | 441681 | identical | 183.4 |
| idle | 3.13.14 | interp | mon_branch | 56.7 | 2.0 | 221100 | identical | 256.5 |
| idle | 3.13.14 | interp | mon_instr | 275.9 | 9.5 | 2317010 | identical | 119.1 |
| idle | 3.13.14 | interp | native | 29.0 | 1.0 | – | – | – |
| idle | 3.13.14 | interp | opcodes | 35.3 | 1.2 | 4563 | identical | 7737.7 |
| idle | 3.13.14 | memory | calls | 47.3 | 1.4 | 140005 | identical | 338.0 |
| idle | 3.13.14 | memory | lines | 73.9 | 2.2 | 350008 | identical | 211.0 |
| idle | 3.13.14 | memory | mon_branch | 62.4 | 1.9 | 280004 | identical | 222.9 |
| idle | 3.13.14 | memory | mon_instr | 264.3 | 7.9 | 2030036 | identical | 130.2 |
| idle | 3.13.14 | memory | native | 33.3 | 1.0 | – | – | – |
| idle | 3.13.14 | memory | opcodes | 35.2 | 1.1 | 0 | identical | – |
| autogroup | 3.11.15 | interp | native | 31.3 | 1.0 | – | – | – |
| autogroup | 3.11.15 | interp | opcodes | 453.2 | 14.5 | 2647575 | identical | 171.2 |
| autogroup | 3.12.3 | interp | mon_instr | 554.0 | 18.4 | 2537052 | identical | 218.4 |
| autogroup | 3.12.3 | interp | native | 30.2 | 1.0 | – | – | – |
| autogroup | 3.12.3 | interp | opcodes | 47.1 | 1.6 | 0 | identical | – |

## WebAssembly fuel (wasmtime)

| condition | mode | CPU p50 ms | CV % | p5 | p95 | fuel | fuel across runs |
|---|---|---|---|---|---|---|---|
| idle | native | 26.03 | 8.9 | 25.56 | 32.26 | – | – |
| idle | wasm | 32.81 | 9.4 | 32.30 | 33.56 | – | – |
| idle | wasm_fuel | 36.84 | 12.2 | 35.87 | 51.28 | 478852091 | identical |
| autogroup | native | 26.15 | 2.1 | 25.57 | 27.05 | – | – |
| autogroup | wasm | 32.82 | 2.7 | 32.17 | 34.37 | – | – |
| autogroup | wasm_fuel | 36.35 | 2.9 | 35.71 | 38.27 | 478852091 | identical |

- idle: given 478852091 fuel → completed

- idle: given 478852090 fuel → completed

- idle: given 478851991 fuel → trapped: error while executing at wasm backtrace:

- idle: given 478842091 fuel → trapped: error while executing at wasm backtrace:

- idle: given 477852091 fuel → trapped: error while executing at wasm backtrace:

- autogroup: given 478852091 fuel → completed

- autogroup: given 478852090 fuel → completed

- autogroup: given 478851991 fuel → trapped: error while executing at wasm backtrace:

- autogroup: given 478842091 fuel → trapped: error while executing at wasm backtrace:

- autogroup: given 477852091 fuel → trapped: error while executing at wasm backtrace:

## Per-call machinery costs (idle, us)

| what | p50 | p95 | max |
|---|---|---|---|
| fork_call_us | 1008.3 | 1603.2 | 1895.7 |
| perf_open_cold_us | 6864.6 | 10290.7 | 10290.7 |
| perf_open_warm_us | 276.4 | 425.2 | 1975.1 |
| perf_read_us | 22.7 | 27.8 | 87.2 |
| cpuclock_read_us | 0.5 | 0.9 | 24.3 |
| schedstat_read_us | 9.2 | 17.2 | 358.2 |
| perf_distinct_values_in_2ms | 76 |  |  |
| cpuclock_distinct_values_in_2ms | 1 |  |  |
| schedstat_distinct_values_in_2ms | 2 |  |  |
| setitimer_us | 0.8 | 1.4 | 33.7 |
| cgroup_cycle_us | 562.8 | 939.3 | 19333.8 |

