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
