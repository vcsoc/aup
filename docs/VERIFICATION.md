# Verification evidence

Verified locally on **2026-10-14**, macOS 26.5.2 / ARM64, Node.js 22.22.2,
npm 10.9.7, Electron 44.7.2.

## Executed successfully

| Check | Evidence |
| --- | --- |
| Strict TypeScript | `npm run typecheck` passes for renderer/shared/main code and tests |
| Unit/integration suite | `npm test`: **104 tests, 10 files, all passing** |
| Production build | `npm run build`: main/worker compilation and local Vite renderer assets |
| Worker integration | `node scripts/worker-smoke.mjs`: isolated Claude/Codex/Pi/import fixtures, copied-response deduplication, backend attribution, cached-read breakdown, quotas off, projected metadata, settings reset |
| Desktop UI | `node scripts/smoke.mjs`: launches actual Electron, checks content-fitted 420px window height (including shrink-on-filter), larger matching token/CPU/RAM colors, wider charts, today costs, provider/day Stats tabs, editable inclusive dates, validation, week navigation, provider filtering, keyboard tabs, locally loaded JetBrains Mono, settings, dark/light themes, narrow/wide resizing and refresh |
| Activity ordering | Live rows and provider picker use running state, today's processed tokens, last request/prompt time, then recent volume, with deterministic name/ID ties. Unit tests cover updates, no mutation/CPU jitter, imports and invalid/future dates. Development/installed smoke checks assert exact demo order, fixture Codex first, and descending Stats totals. |
| Running status color | v0.2.1 development and installed UI checks assert bright green Running text/dots in dark mode, saturated contrast-safe green in light mode, and muted Idle labels. |
| Runtime isolation | Smoke checks confirm sandbox/context isolation enabled, Node integration disabled, no renderer `require`/`process` or arbitrary filesystem preload method |
| Real host + worker | `node scripts/host-smoke.mjs`: temporary profile, actual collection, settings persisted through IPC, malicious imported name escaped, fixture credential/content not included in snapshot, renderer networking denied, recorded Pi/Codex costs deduplicated, partial cost/date totals and oversize-file warnings shown in Stats, invalid height IPC rejected |
| Login launch integration | `node scripts/startup-smoke.mjs`: hidden `--startup` launch, nonempty native menu-bar image with opaque pixels, macOS template flag and positive native bounds even with no quota title, tray-unavailable fallback, reopen, old-settings migration, demo/smoke registration isolation |
| Actual macOS login item | Installed v0.2.0 launched with the normal profile and **without** demo/smoke flags; native `app.getLoginItemSettings().openAtLogin === true`. Its actual menu-bar item had a nonempty template image, opaque pixels, and positive native bounds (38×30). Earlier v0.1.2 verification also checked the enabled/checked Settings checkbox and explicit hidden `--startup` reopening. No reboot/logout was performed; native macOS login-launch detection still needs an actual login cycle. |
| Native process sampler | `collectProcesses` executed against macOS' actual process table; recognized active Pi/Codex trees and returned aggregate CPU/RSS only |
| Unpacked application | `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack`: creates native ARM64 `.app` |
| Packaged runtime | `scripts/smoke.mjs`, `scripts/host-smoke.mjs`, and `scripts/startup-smoke.mjs` pass with `AUP_EXECUTABLE` pointing at the unpacked `.app` executable, including its ASAR-packaged worker/dependencies and bundled JetBrains Mono |
| Install image | `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64`: creates unsigned ARM64 DMG |
| Installed update | Installed v0.2.2 at `/Applications/Agent Usage Panel.app`; UI, real-host, and login/tray smoke scripts passed against that executable using temporary profiles. Verified actual retained-history Stats with the normal profile, then relaunched the normal app and left it running with its menu-bar item. Existing settings/profile directories were not replaced. The previous v0.2.1 bundle is retained under `~/Library/Caches/Agent Usage Panel/backups/20261014-163004/` (earlier backups also retained). |
| Actual public pricing refresh | Installed normal app's **Update prices** completed successfully on `2026-10-14T19:54:26.608Z`, caching **8,356** current public model prices and rescanning actual history without a pricing error. Bundled baseline remains 8,355 models from the earlier same-day fetch. This request was separate from provider quota checks and carried no account/usage data. |
| Dependencies | `npm audit`: **0 vulnerabilities** (including development dependencies) |
| Upstream preservation | All **30 vendored files** compared byte-for-byte against pinned Omarchy commit `84cfb93959f4fe0bbb71de71593b36647d2ba78d` |

Smoke screenshots are generated in `.test-results/`; the dark preview is copied
to `docs/panel.png` and provider Stats to `docs/stats.png` for the README. They are explicitly labeled demo data.

## Unit/integration coverage

- Claude partial streaming rows, request deduplication, human/tool-result prompts.
- Codex cumulative-counter deduplication, cached/reasoning token inclusion,
  OpenAI/custom-provider attribution, old metadata compatibility.
- Pi component/fallback totals, copied response/entry deduplication, partial rows,
  long response IDs, explicit cross-log response identity, Codex OAuth attribution
  versus generic OpenAI/other backends, and scanner cache consistency.
- Uncached/cached/processed display units, unknown imported breakdowns, zero rows,
  cache creation versus cache reads, local dates, and invalid cache values.
- Default-on startup settings migration, macOS/Windows registration adapters and
  opt-out, OS refusal/error sanitization, Windows-only status handling, Linux XDG
  entry quoting/field-code escaping, idempotence, removal, AppImage persistence,
  fallback config path, write errors, and isolated-session suppression.
- Recorded-cost preference (including zero), copied-response cost deduplication,
  exact model/provider aliases, cached read/write pricing, context tiers and exact
  threshold transitions, unknown/missing components, overflow, repricing unchanged
  file-cache entries, older daily history, bounded public fetching, redirect
  refusal, offline cache fallback, and source/rate validation.
- Inclusive local dates, full Monday–Sunday defaults, calendar week shifts across
  year/DST boundaries, invalid dates/ranges, provider/day aggregation, unknown
  imported coverage, partial/tiny cost labels, and bounded long-range row creation.
- Grok per-turn ledgers.
- Local day boundaries, seven-day windows, invalid timestamps, prototype-like
  model keys, copied transcript messages, cache append/deletion invalidation.
- Process executable/runtime matching on POSIX and Windows-style paths,
  false-positive avoidance, descendant/nested-agent ownership, cyclic/vanished
  parents, exclusion of monitor/probe trees, invalid metrics.
- Claude/Codex/Kimi quota formats, fixed-host HTTPS enforcement, redirect
  rejection, HTTP failures, response bounds, opt-in, cooldown, stale retention,
  and credential-rotation cache isolation (mock transport).
- Fake Codex app-server subprocess: fragmented/coalesced frames, invalid rows,
  executable paths with spaces, exit errors, and process cleanup. Subprocess
  fixture tests use a POSIX executable and are skipped on Windows.
- Settings validation, absolute paths, atomic save/load, corrupt settings,
  Omarchy records/accounts/unknown providers, stale imports, invalid files,
  traversal caps, and symlink avoidance (POSIX symlink test skipped on Windows).

## Configured, not executed locally

`.github/workflows/ci.yml` runs check, audit, Electron smoke, and unpacked
packaging on Ubuntu, macOS, and Windows. Manual workflow runs/tags build unsigned
installers. This repository was created locally; **no hosted CI result is claimed**.

Not verified on native Linux or Windows, macOS x64, or Windows/Linux ARM64.
Windows npm CLI-shim resolution is implemented, but has not been exercised on a
Windows host. Wayland positioning, GNOME tray extensions, taskbar overflow,
notification permission prompts, and every distro's runtime libraries require
native testing. Cross-platform source and build targets are not proof that every
desktop/distribution works.

No real provider credentials were sent to provider quota endpoints during
verification. Provider HTTP behavior uses fixtures/mocks, and Codex RPC uses a
fake executable. Live account responses can change and require smoke checks
with consenting accounts before a public release. The vendored upstream shell
suite is reference material, not counted among this project's passing tests.

## Local artifacts

- `release/mac-arm64/Agent Usage Panel.app`
- `release/Agent Usage Panel-0.2.2-arm64.dmg`

Build outputs are ignored by Git. The app is unsigned and unnotarized; no signing
identity was used and nothing was published. See the README for building on each
platform and configuring your own signing credentials.
