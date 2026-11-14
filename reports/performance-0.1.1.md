# HeySurf 0.1.1 validation

Measured on this Apple Silicon Mac with Electron 45.3.2. These are local synthetic results, not a guarantee for every conversation or a long-running memory soak test.

## Rapid-scroll benchmark

The same 600 synthetic messages were rendered with production React and the real Markdown renderer. Each foreground window scrolled through the full history repeatedly for six seconds. The baseline used the installed 0.1.0 shell and committed frontend; the optimized run used the packaged 0.1.1 shell and working frontend.

| Measurement | Baseline | Optimized |
| --- | ---: | ---: |
| Maximum mounted message rows | 600 | 18 |
| Retained JavaScript heap after forced GC | 17.54 MiB | 9.67 MiB |
| Combined Electron process CPU, average | 64.94% | 44.06% |
| GPU process CPU, average | 29.98% | 7.83% |
| Renderer process CPU, average | 31.63% | 34.76% |
| Renderer RSS immediately after scrolling | 268.13 MiB | 252.80 MiB |
| Frames longer than 34 ms during scrolling | 0 | 0 |
| JavaScript long tasks during scrolling | 0 | 0 |

CPU is accumulated process CPU time divided by elapsed time, expressed as a percentage of one CPU core. Combined CPU includes the main, GPU, network, and renderer processes. Renderer CPU remains slightly higher during full-history traversals because virtual rows are mounted as they enter the viewport; graphics and combined CPU are lower. The bounded parser cache and row memoization reduce that tradeoff.

Retained JS heap is only one part of RAM usage. Total resident process memory improved modestly in this test. RSS can include shared pages, and neither RSS nor forced-GC heap is an exact unique physical-memory total. Startup, authenticated APIs, live browser previews, and real user workloads are outside this fixture.

The raw JSON records the baseline commit, frame counts, process measurements, and page errors. Both runs were focused and visible, and reported no page errors.

## Regression checks

Twenty checks passed across native Electron and frontend suites. Coverage includes rapid scroll reversals in a 500-message conversation, streaming follow behavior, reading-position preservation, prepending history, selection retention, revealing an unmounted message, switching conversations, resizing, cold/warm Markdown formatting and sanitization, bubble delivery, replay/reconnect races, glass accessibility fallbacks, auth-navigation deduplication, single-window popup behavior, packaged-app reopening, and hang diagnostics.

The frontend production build and TypeScript checks passed. The packaged ARM64 app passed native Electron tests. The original sporadic freeze has not been proven eliminated under all real workloads; the added lifecycle diagnostics support investigation if it recurs.

## Storage and rollout

Redundant Intel and ZIP build products were removed after validating the new package. The output folder fell from 1,111.9 MiB before cleanup to 479.6 MiB, while retaining the previous ARM64 DMG for rollback. This is build-output cleanup, not a comparable reduction in installed runtime size.

The new ARM64 DMG is `../dist/HeySurf-0.1.1-arm64.dmg`. It applies the shell's graphics, navigation, cache, and recovery changes immediately. The chat virtualization and parser-cache changes remain local in `anyx-code` until its frontend is deployed to heysurf.dev. No production deployment was performed.
