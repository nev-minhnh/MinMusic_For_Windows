# Performance results

Worst of N runs counts (median in brackets). dropped = DROPPED + PRESENTED_PARTIAL over non-idle frames.

| date | scenario | size | runs | frames (worst) | dropped % worst (median) | dropped (per transition) | long tasks | max long task ms | PM long gaps | input p95 ms | input via | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-22 | CAL (jank) | 1920 | 3 | 680 | 13.24 (9.83) | - | 6 | 120.2 | n/a | 81.1 | cdp-fallback | PASS |
| 2026-11-22 | CAL (clean) | 1920 | 3 | 624 | 4.17 (1.99) | - | 0 | 0 | n/a | 58 | cdp-fallback | PASS |
| 2026-11-22 | CAL-IDLE (idle) | 1920 | 3 | 0 | 0 (0) | - | 0 | 0 | n/a | - | sendinput | PASS |
| 2026-11-23 | P2 | 1920 | 1 | 89 | 100 (100) | - | 0 | 0 | n/a | 2.3 | cdp-fallback | FAIL: dropped 100% > 0.5% |
| 2026-11-23 | P3 | 1920 | 1 | 459 | 12.85 (12.85) | 2.95 | 0 | 0 | n/a | 85.3 | cdp-fallback | FAIL: dropped/transition 2.95 > 1 |
| 2026-11-23 | P4 | 1920 | 1 | 986 | 5.58 (5.58) | 1.38 | 0 | 0 | n/a | 34.5 | cdp-fallback | FAIL: dropped/transition 1.38 > 1 |
| 2026-11-23 | P7 (derived) | 1920 | - | - | - | - | 0 | - | - | - | - | PASS |

INT-W1 note (2026-11-23): P2-P4 above are the first app rows (no M0 baseline to compare). Desktop unlocked, but other agents were running on the machine, PresentMon was unavailable (no ETW rights) and input fell back to CDP, so treat them as indicative only. P1 and P5 were not run: they need the 5,000-song seeded library (M1-2b, wave 2). Core warm READY on the W1 image: 281-329 ms (6 runs).
| 2026-11-23 | P1 | 1920 | 3 | 95 | 100 (100) | - | 0 | 0 | n/a | 74.1 | cdp-fallback | FAIL: dropped 100% > 0.5% |
| 2026-11-23 | P2 | 1920 | 3 | 92 | 100 (100) | - | 0 | 0 | n/a | 76.4 | cdp-fallback | FAIL: dropped 100% > 0.5% |
| 2026-11-23 | P3 | 1920 | 3 | 283 | 20.85 (17.27) | 2.95 | 0 | 0 | n/a | 58.8 | cdp-fallback | FAIL: dropped/transition 2.95 > 1 |
| 2026-11-23 | P4 | 1920 | 3 | 975 | 4.21 (3.7) | 1.02 | 0 | 0 | n/a | 27.8 | cdp-fallback | FAIL: dropped/transition 1.02 > 1 |
| 2026-11-23 | P5 | 1920 | 3 | 74 | 6.76 (5.71) | - | 0 | 0 | n/a | 15.4 | cdp-fallback | FAIL: dropped 5 > 0 |
| 2026-11-23 | P7 (derived) | 1920 | - | - | - | - | 0 | - | - | - | - | PASS |
| 2026-11-23 | P1 | 4k | 3 | 100 | 100 (100) | - | 0 | 0 | n/a | 78.5 | cdp-fallback | FAIL: dropped 100% > 1% |
| 2026-11-23 | P2 | 4k | 3 | 99 | 100 (100) | - | 0 | 0 | n/a | 80.3 | cdp-fallback | FAIL: dropped 100% > 1% |
| 2026-11-23 | P3 | 4k | 3 | 280 | 20.71 (18.18) | 2.9 | 0 | 0 | n/a | 76.7 | cdp-fallback | FAIL: dropped/transition 2.9 > 1 |
| 2026-11-23 | P4 | 4k | 3 | 974 | 4.41 (3.99) | 1.08 | 0 | 0 | n/a | 33.6 | cdp-fallback | PASS |
| 2026-11-23 | P5 | 4k | 3 | 73 | 8.22 (4.23) | - | 0 | 0 | n/a | 15.4 | cdp-fallback | FAIL: dropped 8.22% > 0.5% |
| 2026-11-23 | P7 (derived) | 4k | - | - | - | - | 0 | - | - | - | - | PASS |

INT-W5 note (2026-11-23, waves 2-5 integrated, core c9fb9803): the 1920 and 4k rows above ran with the Windows session LOCKED (LogonUI present), PresentMon unavailable (no ETW rights) and CDP input fallback. A locked session does not present frames to DWM, so P1/P2 show 100 % "dropped" on every run, the same signature as the W1 P2 row; treat all dropped-frame figures as not measured. What the rows do show: 0 long tasks and 0 ms max long task in every scenario at both sizes (5,000-song seeded library, fixture Home), input p95 13-34 ms for P4/P5 and 24-80 ms for the CDP-driven wheel and navigation scenarios. P1-P5 need a re-run on an unlocked desktop (owner session) before the W6 gate.
