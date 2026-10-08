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

Controls (CPU an exit costs, ms): idle 0.389 (0.582 with a perf event), autogroup 0.440 (0.435 with a perf event), cpuidle 0.332 (0.535 with a perf event), cpuset 0.436 (0.410 with a perf event), contained 0.381 (0.330 with a perf event)

### workload: py

| condition | mechanism | over p50 | over p95 | min | max | > R/2 late | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|---|
| idle | real | 0.062 | 0.115 | -3.029 | 0.139 | 0 | 3:0.07 10:0.09 50:-0.03 150:-0.83 | 1.07 | caught:60 |
| idle | prof | 3.539 | 5.996 | 1.441 | 6.764 | 19 | 3:2.69 10:4.42 50:3.54 150:3.58 | 1.32 | caught:60 |
| idle | virtual | 4.053 | 9.720 | 1.625 | 13.717 | 16 | 3:3.05 10:3.74 50:5.62 150:6.55 | 1.30 | caught:60 |
| idle | posix | 2.781 | 4.123 | 0.401 | 4.432 | 11 | 3:2.78 10:2.80 50:3.25 150:2.24 | 1.17 | caught:60 |
| idle | prof_kill | 3.787 | 5.599 | 1.275 | 6.208 | 12 | 3:2.96 10:4.10 50:3.50 150:3.64 | 1.31 | died:60 |
| idle | rearm | 0.049 | 0.097 | -0.069 | 0.108 | 0 | 3:0.05 10:0.08 50:0.06 150:0.01 | 1.08 | caught:60 |
| idle | watchdog | 0.202 | 0.320 | 0.025 | 0.449 | 0 | 3:0.21 10:0.22 50:0.20 150:0.16 | 1.08 | killed:60 |
| idle | schedstat | 0.341 | 0.480 | 0.058 | 0.603 | 0 | 3:0.28 10:0.38 50:0.34 150:0.28 | 1.09 | killed:60 |
| idle | watchdog_perf | 0.229 | 0.340 | -12.384 | 1.506 | 0 | 3:0.24 10:0.25 50:0.21 150:-0.18 | 1.07 | killed:60 |
| idle | watchdog_rt | 0.179 | 0.302 | -3.609 | 1.437 | 0 | 3:0.17 10:0.21 50:0.19 150:-1.56 | 1.08 | killed:60 |
| idle | perf_kill | -0.003 | 3.006 | -32.410 | 148.124 | 4 | 3:0.01 10:0.00 50:-0.10 150:-0.12 | 1.07 | died:60 |
| idle | perf_sigtrap | -0.013 | 49.848 | -20.979 | 147.446 | 6 | 3:-0.01 10:-0.01 50:-0.01 150:-0.62 | 1.09 | died:60 |
| autogroup | real | -3.993 | 0.023 | -80.981 | 0.085 | 0 | 3:-0.02 10:-1.55 50:-18.96 150:-42.85 | 1.08 | caught:60 |
| autogroup | prof | 4.382 | 8.792 | -2.752 | 18.515 | 23 | 3:3.35 10:5.26 50:5.63 150:4.06 | 2.15 | caught:60 |
| autogroup | virtual | 4.262 | 14.717 | -3.163 | 24.007 | 18 | 3:4.11 10:3.92 50:4.79 150:12.04 | 1.88 | caught:60 |
| autogroup | posix | 2.431 | 4.299 | 0.241 | 6.260 | 11 | 3:2.47 10:2.27 50:1.91 150:2.62 | 2.04 | caught:60 |
| autogroup | prof_kill | 4.163 | 9.806 | -3.425 | 11.020 | 18 | 3:4.08 10:4.21 50:4.18 150:3.62 | 2.19 | died:60 |
| autogroup | rearm | -0.008 | 0.039 | -0.073 | 0.069 | 0 | 3:-0.01 10:-0.01 50:-0.01 150:-0.00 | 1.48 | caught:60 |
| autogroup | watchdog | 0.037 | 0.050 | -0.020 | 0.505 | 0 | 3:0.04 10:0.04 50:0.04 150:0.04 | 1.31 | killed:60 |
| autogroup | schedstat | 0.038 | 0.828 | -0.003 | 1.457 | 0 | 3:0.03 10:0.04 50:0.04 150:0.05 | 1.66 | killed:60 |
| autogroup | watchdog_perf | 0.007 | 0.920 | -10.974 | 1.453 | 0 | 3:0.04 10:0.01 50:0.02 150:-0.19 | 1.50 | killed:60 |
| autogroup | watchdog_rt | -0.057 | 0.141 | -3.108 | 0.165 | 0 | 3:-0.00 10:-0.04 50:-0.24 150:-0.38 | 1.23 | killed:60 |
| autogroup | perf_kill | -0.029 | 9.986 | -2.569 | 149.178 | 5 | 3:0.00 10:0.00 50:-0.08 150:-0.43 | 1.49 | died:60 |
| autogroup | perf_sigtrap | -0.035 | 0.008 | -2.541 | 149.659 | 2 | 3:-0.01 10:-0.02 50:-0.24 150:-0.27 | 1.62 | died:60 |
| cpuidle | real | 0.008 | 0.098 | -6.929 | 0.113 | 0 | 3:0.03 10:0.08 50:-0.10 150:-0.23 | 1.07 | caught:60 |
| cpuidle | prof | 3.688 | 5.890 | 0.864 | 6.111 | 16 | 3:2.90 10:4.15 50:4.28 150:2.74 | 1.35 | caught:60 |
| cpuidle | virtual | 4.017 | 9.635 | -1.582 | 12.208 | 15 | 3:3.41 10:3.82 50:4.08 150:4.31 | 1.33 | caught:60 |
| cpuidle | posix | 2.694 | 3.903 | 0.301 | 4.199 | 10 | 3:2.79 10:1.61 50:3.12 150:2.58 | 1.13 | caught:60 |
| cpuidle | prof_kill | 3.951 | 6.167 | 1.166 | 9.234 | 14 | 3:2.38 10:3.93 50:4.35 150:3.58 | 1.40 | died:60 |
| cpuidle | rearm | 0.019 | 0.079 | -0.045 | 0.086 | 0 | 3:0.05 10:0.02 50:0.02 150:0.00 | 1.07 | caught:60 |
| cpuidle | watchdog | 0.158 | 0.276 | 0.003 | 0.296 | 0 | 3:0.16 10:0.11 50:0.12 150:0.18 | 1.06 | killed:60 |
| cpuidle | schedstat | 0.242 | 0.438 | 0.009 | 1.054 | 0 | 3:0.25 10:0.25 50:0.30 150:0.17 | 1.09 | killed:60 |
| cpuidle | watchdog_perf | 0.178 | 0.296 | -5.866 | 0.393 | 0 | 3:0.21 10:0.20 50:0.16 150:0.02 | 1.08 | killed:60 |
| cpuidle | watchdog_rt | 0.000 | 0.218 | -6.625 | 0.281 | 0 | 3:-0.00 10:0.10 50:0.03 150:-0.39 | 1.07 | killed:60 |
| cpuidle | perf_kill | 0.002 | 0.037 | -7.343 | 49.938 | 2 | 3:0.00 10:0.00 50:-0.01 150:-0.08 | 1.07 | died:60 |
| cpuidle | perf_sigtrap | -0.022 | -0.007 | -4.212 | 146.926 | 3 | 3:-0.01 10:-0.01 50:-0.10 150:-0.15 | 1.09 | died:60 |
| cpuset | real | -0.022 | 0.095 | -19.917 | 0.178 | 0 | 3:0.07 10:0.07 50:-0.93 150:-2.62 | 1.07 | caught:60 |
| cpuset | prof | 3.447 | 5.606 | -0.009 | 7.682 | 17 | 3:2.93 10:3.99 50:3.58 150:3.07 | 1.28 | caught:60 |
| cpuset | virtual | 3.770 | 10.385 | 1.357 | 12.569 | 16 | 3:2.55 10:3.72 50:4.24 150:5.77 | 1.30 | caught:60 |
| cpuset | posix | 2.268 | 3.833 | 0.234 | 4.153 | 9 | 3:2.27 10:2.42 50:2.20 150:2.09 | 1.16 | caught:60 |
| cpuset | prof_kill | 3.316 | 5.650 | 0.853 | 7.160 | 9 | 3:2.14 10:3.64 50:3.53 150:3.19 | 1.30 | died:60 |
| cpuset | rearm | 0.015 | 0.071 | -0.056 | 0.112 | 0 | 3:0.05 10:0.05 50:0.00 150:0.01 | 1.07 | caught:60 |
| cpuset | watchdog | 0.192 | 0.331 | 0.017 | 0.397 | 0 | 3:0.20 10:0.21 50:0.14 150:0.17 | 1.08 | killed:60 |
| cpuset | schedstat | 0.279 | 0.461 | -0.015 | 0.559 | 0 | 3:0.27 10:0.32 50:0.25 150:0.22 | 1.09 | killed:60 |
| cpuset | watchdog_perf | 0.197 | 0.335 | -8.392 | 0.635 | 0 | 3:0.21 10:0.22 50:0.19 150:-0.26 | 1.08 | killed:60 |
| cpuset | watchdog_rt | 0.166 | 0.296 | -8.577 | 0.349 | 0 | 3:0.18 10:0.20 50:0.05 150:0.09 | 1.08 | killed:60 |
| cpuset | perf_kill | 0.001 | 9.827 | -4.812 | 95.315 | 5 | 3:0.00 10:0.00 50:-0.09 150:-0.34 | 1.07 | died:60 |
| cpuset | perf_sigtrap | -0.074 | -0.009 | -8.536 | 9.406 | 3 | 3:-0.01 10:-0.02 50:-0.12 150:-0.30 | 1.08 | died:60 |
| contained | real | 0.006 | 0.093 | -6.459 | 0.097 | 0 | 3:0.06 10:0.04 50:-0.08 150:-0.35 | 1.07 | caught:60 |
| contained | prof | 3.742 | 5.735 | 1.368 | 6.109 | 19 | 3:3.14 10:4.46 50:3.52 150:3.74 | 1.38 | caught:60 |
| contained | virtual | 4.386 | 10.709 | 1.160 | 11.291 | 11 | 3:2.92 10:3.65 50:4.45 150:7.11 | 1.29 | caught:60 |
| contained | posix | 2.634 | 3.992 | 0.348 | 4.521 | 11 | 3:2.66 10:2.89 50:2.63 150:2.31 | 1.19 | caught:60 |
| contained | prof_kill | 3.447 | 5.359 | 1.102 | 6.277 | 13 | 3:2.33 10:3.70 50:4.04 150:4.06 | 1.30 | died:60 |
| contained | rearm | 0.035 | 0.081 | -0.080 | 0.115 | 0 | 3:0.05 10:0.07 50:0.03 150:-0.00 | 1.08 | caught:60 |
| contained | watchdog | 0.206 | 0.337 | 0.020 | 0.444 | 0 | 3:0.21 10:0.23 50:0.17 150:0.21 | 1.08 | killed:60 |
| contained | schedstat | 0.342 | 0.488 | 0.045 | 0.760 | 0 | 3:0.31 10:0.36 50:0.28 150:0.36 | 1.09 | killed:60 |
| contained | watchdog_perf | 0.207 | 0.552 | -3.222 | 1.135 | 0 | 3:0.23 10:0.21 50:0.11 150:0.09 | 1.07 | killed:60 |
| contained | watchdog_rt | 0.184 | 0.320 | -6.503 | 0.756 | 0 | 3:0.18 10:0.23 50:0.20 150:-0.75 | 1.08 | killed:60 |
| contained | perf_kill | -0.051 | 0.008 | -11.825 | 10.004 | 3 | 3:0.00 10:0.00 50:-0.07 150:-0.25 | 1.07 | died:60 |
| contained | perf_sigtrap | -0.037 | -0.009 | -6.810 | 99.898 | 2 | 3:-0.01 10:-0.02 50:-0.05 150:-0.76 | 1.09 | died:60 |

### workload: c

| condition | mechanism | over p50 | over p95 | min | max | > R/2 late | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|---|
| idle | real | 93.053 | 157.255 | 51.109 | 169.313 | 16 | 3:104.71 10:157.25 50:79.52 150:78.79 | 10.29 | caught:16 |
| idle | prof | 93.368 | 131.457 | 52.241 | 141.777 | 13 | 3:119.79 10:93.91 50:52.83 150:61.90 | 10.17 | caught:16 |
| idle | virtual | 93.667 | 166.019 | 51.234 | 168.177 | 12 | 3:103.02 10:99.41 50:53.73 150:61.11 | 10.49 | caught:16 |
| idle | posix | 94.399 | 102.035 | 55.054 | 122.879 | 14 | 3:101.93 10:97.80 50:63.66 150:92.67 | 10.33 | caught:16 |
| idle | prof_kill | 3.522 | 4.929 | 1.685 | 5.936 | 3 | 3:3.52 10:3.86 50:3.76 150:3.41 | 1.31 | died:16 |
| idle | rearm | 94.569 | 126.052 | 51.267 | 133.187 | 13 | 3:100.70 10:101.34 50:58.14 150:72.39 | 10.56 | caught:16 |
| idle | watchdog | 3.738 | 4.148 | 2.728 | 4.495 | 4 | 3:3.74 10:3.94 50:3.73 150:4.03 | 1.33 | killed:16 |
| idle | schedstat | 3.579 | 4.396 | 0.691 | 4.792 | 3 | 3:3.88 10:3.58 50:4.23 150:3.81 | 1.13 | killed:16 |
| idle | watchdog_perf | 0.063 | 0.454 | -1.597 | 0.469 | 0 | 3:0.06 10:0.45 50:0.15 150:0.19 | 1.09 | killed:16 |
| idle | watchdog_rt | 0.144 | 0.496 | -3.389 | 0.988 | 0 | 3:0.00 10:0.24 50:0.26 150:0.37 | 1.08 | killed:16 |
| idle | perf_kill | -0.041 | 0.071 | -3.568 | 0.280 | 0 | 3:-0.04 10:-0.03 50:0.02 150:-0.18 | 1.07 | died:16 |
| idle | perf_sigtrap | -0.110 | 0.007 | -4.427 | 0.014 | 0 | 3:-0.11 10:-0.06 50:-0.06 150:-0.00 | 1.09 | died:16 |
| autogroup | real | 97.840 | 107.958 | -44.817 | 110.600 | 13 | 3:104.44 10:99.93 50:62.56 150:66.10 | 11.15 | caught:16 |
| autogroup | prof | 95.073 | 106.953 | 55.479 | 108.635 | 12 | 3:106.53 10:100.56 50:60.59 150:62.67 | 13.38 | caught:16 |
| autogroup | virtual | 95.463 | 106.337 | 55.668 | 135.349 | 12 | 3:105.92 10:97.32 50:56.77 150:70.82 | 10.79 | caught:16 |
| autogroup | posix | 94.556 | 104.607 | 9.556 | 107.143 | 12 | 3:104.61 10:100.37 50:61.81 150:62.38 | 10.73 | caught:16 |
| autogroup | prof_kill | 4.344 | 9.066 | 1.812 | 15.315 | 5 | 3:4.11 10:4.34 50:5.09 150:9.07 | 2.09 | died:16 |
| autogroup | rearm | 94.684 | 159.022 | 57.031 | 220.294 | 12 | 3:159.02 10:107.90 50:65.72 150:63.40 | 13.52 | caught:16 |
| autogroup | watchdog | 0.120 | 0.982 | 0.039 | 3.401 | 1 | 3:0.98 10:0.11 50:0.12 150:0.14 | 1.67 | killed:16 |
| autogroup | schedstat | 0.146 | 3.697 | -0.008 | 3.983 | 0 | 3:0.15 10:0.15 50:0.15 150:0.13 | 1.65 | killed:16 |
| autogroup | watchdog_perf | 0.054 | 0.482 | -11.460 | 3.991 | 0 | 3:-0.03 10:0.06 50:0.17 150:-0.14 | 1.52 | killed:16 |
| autogroup | watchdog_rt | -0.059 | 0.357 | -0.373 | 0.482 | 0 | 3:-0.09 10:0.36 50:-0.12 150:-0.06 | 1.58 | killed:16 |
| autogroup | perf_kill | 0.025 | 0.141 | -5.983 | 0.672 | 0 | 3:0.03 10:0.14 50:0.03 150:-1.52 | 1.69 | died:16 |
| autogroup | perf_sigtrap | 0.005 | 0.136 | -2.521 | 3.135 | 1 | 3:0.07 10:0.06 50:0.01 150:-0.01 | 1.57 | died:16 |
| cpuidle | real | 95.286 | 122.658 | 54.135 | 146.778 | 12 | 3:115.35 10:111.52 50:57.17 150:67.28 | 11.01 | caught:16 |
| cpuidle | prof | 95.858 | 137.476 | 61.079 | 161.504 | 14 | 3:105.71 10:95.86 50:79.43 150:102.93 | 10.58 | caught:16 |
| cpuidle | virtual | 99.309 | 133.867 | 56.110 | 175.963 | 12 | 3:103.86 10:100.83 50:60.76 150:65.71 | 11.17 | caught:16 |
| cpuidle | posix | 97.212 | 106.835 | 58.343 | 171.147 | 13 | 3:102.83 10:104.11 50:95.70 150:66.09 | 10.62 | caught:16 |
| cpuidle | prof_kill | 3.853 | 5.260 | 1.604 | 6.577 | 3 | 3:3.13 10:4.01 50:4.26 150:4.07 | 1.35 | died:16 |
| cpuidle | rearm | 98.998 | 105.391 | 54.436 | 113.251 | 13 | 3:104.64 10:99.00 50:60.72 150:72.70 | 10.65 | caught:16 |
| cpuidle | watchdog | 3.483 | 4.174 | 0.276 | 4.178 | 3 | 3:3.86 10:4.09 50:3.58 150:3.34 | 1.28 | killed:16 |
| cpuidle | schedstat | 3.589 | 4.353 | 0.507 | 4.645 | 2 | 3:3.16 10:4.35 50:3.62 150:3.87 | 1.11 | killed:16 |
| cpuidle | watchdog_perf | 0.281 | 0.613 | -2.758 | 0.982 | 0 | 3:0.28 10:0.35 50:0.46 150:0.28 | 1.08 | killed:16 |
| cpuidle | watchdog_rt | 0.052 | 0.244 | -0.837 | 0.261 | 0 | 3:0.05 10:0.16 50:0.20 150:-0.04 | 1.08 | killed:16 |
| cpuidle | perf_kill | -0.039 | 0.121 | -1.079 | 0.571 | 0 | 3:0.01 10:0.00 50:-0.04 150:-0.36 | 1.06 | died:16 |
| cpuidle | perf_sigtrap | -0.071 | 0.104 | -1.873 | 0.531 | 0 | 3:-0.07 10:0.03 50:-0.02 150:-0.05 | 1.09 | died:16 |
| cpuset | real | 101.003 | 137.015 | 56.077 | 141.920 | 12 | 3:117.25 10:101.00 50:111.40 150:61.74 | 10.84 | caught:16 |
| cpuset | prof | 101.975 | 121.698 | 55.915 | 150.698 | 13 | 3:104.80 10:107.00 50:76.87 150:69.05 | 11.19 | caught:16 |
| cpuset | virtual | 95.600 | 113.967 | 26.832 | 170.092 | 12 | 3:112.35 10:105.24 50:57.21 150:62.85 | 10.71 | caught:16 |
| cpuset | posix | 96.845 | 111.226 | 58.385 | 116.063 | 13 | 3:104.84 10:97.39 50:67.65 150:70.86 | 10.78 | caught:16 |
| cpuset | prof_kill | 3.764 | 5.777 | 1.971 | 6.181 | 3 | 3:3.76 10:3.90 50:3.58 150:5.41 | 1.38 | died:16 |
| cpuset | rearm | 102.985 | 136.456 | 55.086 | 137.038 | 13 | 3:105.04 10:102.98 50:57.62 150:62.37 | 11.04 | caught:16 |
| cpuset | watchdog | 3.531 | 4.048 | 0.363 | 4.379 | 3 | 3:3.89 10:3.98 50:3.53 150:3.22 | 1.14 | killed:16 |
| cpuset | schedstat | 3.888 | 4.208 | 0.594 | 4.344 | 4 | 3:3.54 10:3.89 50:4.17 150:3.91 | 1.35 | killed:16 |
| cpuset | watchdog_perf | 0.208 | 0.525 | -0.916 | 0.741 | 0 | 3:0.21 10:0.35 50:0.37 150:0.13 | 1.08 | killed:16 |
| cpuset | watchdog_rt | 0.194 | 0.344 | -2.871 | 0.511 | 0 | 3:0.19 10:0.28 50:-0.36 150:0.27 | 1.07 | killed:16 |
| cpuset | perf_kill | 0.117 | 0.544 | -1.840 | 0.568 | 0 | 3:0.07 10:0.20 50:0.17 150:0.24 | 1.05 | died:16 |
| cpuset | perf_sigtrap | 0.057 | 0.172 | -5.784 | 0.319 | 0 | 3:0.06 10:0.10 50:0.11 150:-1.43 | 1.08 | died:16 |
| contained | real | 94.075 | 107.829 | 54.102 | 115.088 | 13 | 3:107.83 10:96.28 50:56.37 150:66.12 | 10.28 | caught:16 |
| contained | prof | 93.010 | 113.781 | 51.938 | 118.354 | 13 | 3:111.03 10:103.53 50:52.85 150:60.49 | 10.50 | caught:16 |
| contained | virtual | 91.566 | 99.666 | 52.202 | 110.446 | 12 | 3:99.67 10:92.11 50:53.47 150:61.69 | 10.22 | caught:16 |
| contained | posix | 92.431 | 116.638 | 51.083 | 145.449 | 13 | 3:109.26 10:92.76 50:56.86 150:66.70 | 10.25 | caught:16 |
| contained | prof_kill | 3.741 | 5.491 | 1.895 | 5.952 | 4 | 3:3.74 10:3.26 50:4.58 150:4.63 | 1.30 | died:16 |
| contained | rearm | 96.316 | 133.693 | 16.809 | 168.173 | 13 | 3:101.01 10:107.31 50:70.16 150:57.95 | 10.43 | caught:16 |
| contained | watchdog | 3.406 | 4.171 | 0.402 | 4.277 | 3 | 3:3.52 10:3.62 50:4.17 150:2.60 | 1.29 | killed:16 |
| contained | schedstat | 3.843 | 4.213 | 0.682 | 4.397 | 3 | 3:3.50 10:4.18 50:4.02 150:3.87 | 1.37 | killed:16 |
| contained | watchdog_perf | 0.417 | 0.886 | -1.413 | 1.629 | 0 | 3:0.37 10:0.49 50:0.89 150:0.30 | 1.08 | killed:16 |
| contained | watchdog_rt | 0.344 | 0.766 | -1.790 | 0.791 | 0 | 3:0.26 10:0.77 50:0.42 150:0.53 | 1.08 | killed:16 |
| contained | perf_kill | 0.164 | 0.334 | -0.173 | 0.346 | 0 | 3:0.16 10:0.20 50:0.33 150:0.01 | 1.07 | died:16 |
| contained | perf_sigtrap | 0.069 | 0.216 | -5.166 | 0.258 | 0 | 3:0.11 10:0.20 50:0.22 150:-1.60 | 1.09 | died:16 |

Arming cost (idle, us, p50): perf_kill 249.4, perf_sigtrap 215.2, posix 302.9, prof 34.9, prof_kill 42.9, real 40.0, rearm 79.9, schedstat 0.0, virtual 34.6, watchdog 0.0, watchdog_perf 221.9, watchdog_rt 218.2

Watchdog wake-ups per call (p50/max): autogroup/schedstat 2/64, autogroup/watchdog 2/8, autogroup/watchdog_perf 3/12, autogroup/watchdog_rt 2/54, contained/schedstat 1/10, contained/watchdog 1/12, contained/watchdog_perf 1/1, contained/watchdog_rt 1/2, cpuidle/schedstat 1/7, cpuidle/watchdog 1/5, cpuidle/watchdog_perf 1/2, cpuidle/watchdog_rt 1/2, cpuset/schedstat 1/23, cpuset/watchdog 1/33, cpuset/watchdog_perf 1/5, cpuset/watchdog_rt 1/3, idle/schedstat 1/9, idle/watchdog 1/8, idle/watchdog_perf 1/1, idle/watchdog_rt 1/1

## Stop precision, follow-up (per-thread CPU-timer kill, perf counting kernel time): CPU at the stop − (CPU at arming + R), ms

Controls (CPU an exit costs, ms): idle 0.451 (0.484 with a perf event), autogroup 0.356 (0.424 with a perf event), contained 0.281 (0.309 with a perf event)

### workload: py

| condition | mechanism | over p50 | over p95 | min | max | > R/2 late | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|---|
| idle | prof_kill | 3.343 | 5.304 | 1.190 | 7.042 | 10 | 3:2.57 10:3.63 50:4.16 150:3.16 | 1.39 | died:60 |
| idle | tkill | 2.473 | 3.457 | 0.050 | 3.746 | 10 | 3:2.47 10:2.45 50:2.77 150:1.99 | 1.13 | died:60 |
| idle | rearm | 0.035 | 0.087 | -0.063 | 0.117 | 0 | 3:0.05 10:0.05 50:0.03 150:-0.00 | 1.07 | caught:60 |
| idle | rearm_tkill | 0.050 | 0.091 | -0.032 | 0.103 | 0 | 3:0.05 10:0.06 50:0.06 150:0.02 | 1.11 | caught:60 |
| idle | perf_sigtrap | -0.054 | -0.008 | -4.358 | 9.992 | 2 | 3:-0.01 10:-0.02 50:-0.11 150:-0.36 | 1.08 | died:60 |
| idle | perf_sigtrap_k | -0.049 | -0.008 | -5.900 | -0.007 | 0 | 3:-0.01 10:-0.01 50:-0.18 150:-1.16 | 1.08 | died:60 |
| autogroup | prof_kill | 4.572 | 14.071 | -3.124 | 23.987 | 17 | 3:3.33 10:4.30 50:5.26 150:7.88 | 1.86 | died:60 |
| autogroup | tkill | 2.026 | 3.590 | -0.019 | 6.177 | 10 | 3:2.29 10:2.08 50:1.96 150:1.97 | 1.94 | died:60 |
| autogroup | rearm | 0.001 | 0.019 | -0.075 | 0.070 | 0 | 3:-0.01 10:0.00 50:-0.01 150:0.00 | 1.53 | caught:60 |
| autogroup | rearm_tkill | 0.004 | 0.045 | -0.128 | 0.062 | 0 | 3:-0.00 10:-0.01 50:0.01 150:0.02 | 1.60 | caught:60 |
| autogroup | perf_sigtrap | -0.051 | -0.001 | -4.320 | 149.596 | 3 | 3:-0.01 10:-0.03 50:-0.13 150:-0.52 | 1.86 | died:60 |
| autogroup | perf_sigtrap_k | -0.051 | -0.001 | -3.577 | 0.125 | 0 | 3:-0.02 10:-0.02 50:-0.09 150:-0.75 | 1.59 | died:60 |
| contained | prof_kill | 3.473 | 5.467 | 1.187 | 5.775 | 14 | 3:2.66 10:3.88 50:3.34 150:3.92 | 1.39 | died:60 |
| contained | tkill | 2.444 | 3.760 | 0.029 | 3.963 | 11 | 3:2.40 10:3.15 50:2.99 150:1.58 | 1.19 | died:60 |
| contained | rearm | 0.051 | 0.100 | -0.051 | 0.132 | 0 | 3:0.06 10:0.06 50:0.05 150:0.00 | 1.07 | caught:60 |
| contained | rearm_tkill | 0.043 | 0.084 | -0.086 | 0.092 | 0 | 3:0.05 10:0.05 50:0.03 150:0.01 | 1.11 | caught:60 |
| contained | perf_sigtrap | -0.014 | 9.224 | -19.645 | 149.017 | 6 | 3:-0.01 10:-0.01 50:-0.06 150:-0.15 | 1.08 | died:60 |
| contained | perf_sigtrap_k | -0.028 | -0.008 | -8.428 | -0.008 | 0 | 3:-0.02 10:-0.01 50:-0.15 150:-0.63 | 1.08 | died:60 |

### workload: c

| condition | mechanism | over p50 | over p95 | min | max | > R/2 late | p50 by R | wall÷R p50 | stopped by |
|---|---|---|---|---|---|---|---|---|---|
| idle | prof_kill | 3.655 | 4.901 | 1.868 | 5.372 | 4 | 3:2.83 10:3.65 50:3.94 150:3.92 | 1.30 | died:16 |
| idle | tkill | 1.805 | 3.245 | 0.279 | 3.383 | 1 | 3:1.80 10:2.96 50:2.60 150:2.29 | 1.23 | died:16 |
| idle | rearm | 99.530 | 109.424 | 54.932 | 178.752 | 13 | 3:104.35 10:104.47 50:58.61 150:74.09 | 10.71 | caught:16 |
| idle | rearm_tkill | 6.807 | 7.864 | 5.247 | 7.922 | 8 | 3:7.67 10:6.37 50:7.60 150:7.10 | 1.69 | died:16 |
| idle | perf_sigtrap | 0.019 | 0.102 | -2.772 | 0.176 | 0 | 3:0.00 10:0.09 50:0.05 150:-0.15 | 1.09 | died:16 |
| idle | perf_sigtrap_k | -0.036 | 0.103 | -2.086 | 0.115 | 0 | 3:0.09 10:0.05 50:0.03 150:-1.04 | 1.09 | died:16 |
| autogroup | prof_kill | 4.091 | 8.382 | -2.210 | 17.102 | 5 | 3:3.46 10:4.64 50:5.34 150:6.83 | 1.89 | died:16 |
| autogroup | tkill | 3.224 | 6.492 | 0.055 | 6.973 | 2 | 3:2.93 10:3.53 50:3.52 150:3.22 | 2.27 | died:16 |
| autogroup | rearm | 95.539 | 111.774 | 55.980 | 132.514 | 13 | 3:105.68 10:96.95 50:57.71 150:63.25 | 12.84 | caught:16 |
| autogroup | rearm_tkill | 7.308 | 8.445 | 5.348 | 9.122 | 8 | 3:8.19 10:7.34 50:7.31 150:7.21 | 2.11 | died:16 |
| autogroup | perf_sigtrap | 0.007 | 0.077 | -3.141 | 0.088 | 0 | 3:0.07 10:0.07 50:0.03 150:-0.62 | 1.49 | died:16 |
| autogroup | perf_sigtrap_k | -0.024 | 0.131 | -5.696 | 0.150 | 0 | 3:0.01 10:0.03 50:0.10 150:-4.10 | 1.50 | died:16 |
| contained | prof_kill | 3.470 | 5.799 | 0.736 | 7.232 | 4 | 3:2.35 10:4.37 50:5.44 150:4.27 | 1.33 | died:16 |
| contained | tkill | 3.157 | 3.858 | 1.215 | 3.951 | 2 | 3:2.05 10:3.49 50:3.24 150:3.52 | 1.30 | died:16 |
| contained | rearm | 96.596 | 128.393 | 51.839 | 183.319 | 15 | 3:128.39 10:96.60 50:53.57 150:96.73 | 10.29 | caught:16 |
| contained | rearm_tkill | 7.170 | 8.137 | 5.407 | 8.373 | 8 | 3:6.26 10:7.17 50:7.65 150:7.88 | 1.73 | died:16 |
| contained | perf_sigtrap | 0.187 | 0.515 | -3.398 | 0.526 | 0 | 3:0.13 10:0.49 50:0.10 150:0.34 | 1.09 | died:16 |
| contained | perf_sigtrap_k | 0.189 | 0.343 | -1.415 | 0.344 | 0 | 3:0.13 10:0.17 50:0.33 150:0.24 | 1.08 | died:16 |

Arming cost (idle, us, p50): perf_sigtrap 203.9, perf_sigtrap_k 206.0, prof_kill 49.9, rearm 87.5, rearm_tkill 482.6, tkill 426.3

Host steal time measured during the conditions: idle: 0.36% of CPU time over 43s; autogroup: 0.97% of CPU time over 46s; contained: 0.69% of CPU time over 28s

## TypeScript runner options: CPU at the stop − R (main or worker thread), ms

| condition | mechanism | over p50 | over p95 | min | max | p50 by R | wall÷R p50 | costs |
|---|---|---|---|---|---|---|---|---|
| idle | sigint_perf | -1.736 | 9.795 | -5.842 | 146.369 | 3:-2.32 10:-1.22 50:-2.02 150:-1.88 | 1.03 | arm 167 us |
| idle | sigint_poll | 0.663 | 5.001 | -4.496 | 2977.197 | 3:2.30 10:0.32 50:-0.33 150:0.34 | 1.07 |  |
| idle | vm_wall | -2.001 | 0.459 | -11.042 | 1.857 | 3:-1.79 10:-2.01 50:-2.00 150:-3.11 | 1.01 |  |
| idle | worker_kill | 1.156 | 3.790 | -3.600 | 3.961 | 3:1.91 10:1.47 50:0.66 150:-2.22 | 1.12 | terminate 2.1 ms, respawn 37.3 ms |
| autogroup | sigint_perf | -1.007 | 0.279 | -6.113 | 147.216 | 3:-0.80 10:-0.20 50:-1.90 150:-1.11 | 2.26 | arm 109 us |
| autogroup | sigint_poll | -0.437 | 4.333 | -6.547 | 6.195 | 3:0.02 10:-1.10 50:-0.73 150:-1.30 | 2.29 |  |
| autogroup | vm_wall | -7.656 | -0.324 | -114.812 | -0.005 | 3:-1.82 10:-6.67 50:-30.82 150:-73.27 | 1.11 |  |
| autogroup | worker_kill | -0.961 | 0.720 | -5.802 | 2.810 | 3:-0.99 10:-1.19 50:-1.29 150:-1.85 | 1.87 | terminate 2.2 ms, respawn 90.9 ms |

Fixed JS workload in fresh contexts (ms):

| condition | clock | p50 | CV % | p5 | p95 | max |
|---|---|---|---|---|---|---|
| idle | thread | 31.03 | 2.3 | 30.21 | 32.63 | 32.85 |
| idle | process | 37.26 | 3.7 | 35.14 | 39.62 | 39.83 |
| idle | wall | 30.97 | 3.0 | 29.86 | 32.65 | 33.49 |
| autogroup | thread | 31.93 | 11.5 | 28.19 | 39.30 | 43.97 |
| autogroup | process | 37.24 | 10.7 | 33.31 | 44.48 | 50.61 |
| autogroup | wall | 91.24 | 30.7 | 53.23 | 150.77 | 151.23 |

- worker.cpuUsage() while the worker computes (autogroup): 101 answers in 317 ms; the value changed 95 times, steps (ms) [4.02, 1.83, 2.16, 1.48, 2.44, 3.8, 0.18, 3.18, 1.08, 2.58, 3.91, 4.0]

- worker.cpuUsage() while the worker computes (idle): 139 answers in 304 ms; the value changed 78 times, steps (ms) [4, 2.36, 3.66, 1.66, 5.06, 2.8, 3.65, 0.29, 4.0, 4.0, 4.0, 4.0]

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

