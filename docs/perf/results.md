# Performance results

Worst of N runs counts (median in brackets). dropped = DROPPED + PRESENTED_PARTIAL over non-idle frames.

| date | scenario | size | runs | frames (worst) | dropped % worst (median) | dropped (per transition) | long tasks | max long task ms | PM long gaps | input p95 ms | input via | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-22 | CAL (jank) | 1920 | 3 | 680 | 13.24 (9.83) | - | 6 | 120.2 | n/a | 81.1 | cdp-fallback | PASS |
| 2026-11-22 | CAL (clean) | 1920 | 3 | 624 | 4.17 (1.99) | - | 0 | 0 | n/a | 58 | cdp-fallback | PASS |
| 2026-11-22 | CAL-IDLE (idle) | 1920 | 3 | 0 | 0 (0) | - | 0 | 0 | n/a | - | sendinput | PASS |
