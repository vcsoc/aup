# Verification evidence

Verified locally on **2026-10-14**, macOS 26.5.2 / ARM64, Node.js 22.22.2,
npm 10.9.7, Electron 44.7.2.

## Executed successfully

| Check | Evidence |
| --- | --- |
| Strict TypeScript | `npm run typecheck` passes for renderer/shared/main code and tests |
| Unit/integration suite | `npm test`: **72 tests, 7 files, all passing** |
| Production build | `npm run build`: main/worker compilation and local Vite renderer assets |
| Worker integration | `node scripts/worker-smoke.mjs`: isolated Claude/Codex/Pi/import fixtures, copied-response deduplication, backend attribution, cached-read breakdown, quotas off, projected metadata, settings reset |
| Desktop UI | `node scripts/smoke.mjs`: launches actual Electron, checks the 420×670 default window, thin stacked full-width rows, no intro/privacy banner, refresh icon/tooltip, locally loaded JetBrains Mono throughout the UI, six demo agents, filters, details, settings, dark/light themes, native narrow/wide resizing, keyboard shortcuts, refresh |
| Runtime isolation | Smoke checks confirm sandbox/context isolation enabled, Node integration disabled, no renderer `require`/`process` or arbitrary filesystem preload method |
| Real host + worker | `node scripts/host-smoke.mjs`: temporary profile, actual collection, settings persisted through IPC, malicious imported name escaped, fixture credential/content not included in snapshot, renderer networking denied |
| Login launch integration | `node scripts/startup-smoke.mjs`: hidden `--startup` launch, tray-unavailable fallback, reopen, old-settings migration, demo/smoke registration isolation |
| Actual macOS login item | Installed v0.1.2 launched with an isolated profile but **without** demo/smoke flags; native `app.getLoginItemSettings().openAtLogin === true`, no startup warnings, Settings checkbox enabled/checked. Explicit `--startup` launch stayed hidden and reopened on activation. No reboot/logout was performed; native macOS login-launch detection still needs an actual login cycle. |
| Native process sampler | `collectProcesses` executed against macOS' actual process table; recognized active Pi/Codex trees and returned aggregate CPU/RSS only |
| Unpacked application | `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack`: creates native ARM64 `.app` |
| Packaged runtime | `scripts/smoke.mjs`, `scripts/host-smoke.mjs`, and `scripts/startup-smoke.mjs` pass with `AUP_EXECUTABLE` pointing at the unpacked `.app` executable, including its ASAR-packaged worker/dependencies and bundled JetBrains Mono |
| Install image | `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64`: creates unsigned ARM64 DMG |
| Installed update | Installed v0.1.2 at `/Applications/Agent Usage Panel.app`; UI, real-host, and login-launch smoke scripts passed against that executable using temporary profiles. Relaunched the normal installed app afterward. Existing user-profile directories were not replaced or edited by the update; the previous v0.1.1 bundle is retained under `~/Library/Caches/Agent Usage Panel/backups/20261014-150951/`. |
| Dependencies | `npm audit`: **0 vulnerabilities** (including development dependencies) |
| Upstream preservation | All **30 vendored files** compared byte-for-byte against pinned Omarchy commit `84cfb93959f4fe0bbb71de71593b36647d2ba78d` |

Smoke screenshots are generated in `.test-results/`; the dark preview is copied
to `docs/panel.png` for the README. They are explicitly labeled demo data.

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
- `release/Agent Usage Panel-0.1.2-arm64.dmg`

Build outputs are ignored by Git. The app is unsigned and unnotarized; no signing
identity was used and nothing was published. See the README for building on each
platform and configuring your own signing credentials.
