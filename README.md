# Agent Usage Panel

**Your limits, tokens, and resources. In one quiet place.**

A private desktop menu-bar / system-tray monitor for AI coding agents, inspired
by Omarchy's agent panel. Native desktop integration on macOS, Windows, and
supported Linux desktops; no Hyprland, Quickshell, Bash, Python, or `jq` required.

![Agent Usage Panel in demo mode](docs/panel.png)

## Run it

Requires **Node.js 22.12+** and npm on a supported desktop OS.

```sh
npm ci
npm start
```

Or explore without reading credentials, histories, or processes:

```sh
npm run demo
```

The panel opens immediately, with a robot icon in the menu bar / system tray.
Click it to show or hide the panel; right-click for Open, Refresh, and Quit.
macOS also shows the highest current quota percentage beside the icon. Closing
the window keeps monitoring; **Quit app** actually exits. `R` refreshes,
`Esc` hides the panel, and `Ctrl/Cmd+,` opens settings.

**Network quota checks are off initially.** Open Settings to enable them. Local
history and CPU/RAM monitoring are on and can be independently disabled.

## What it tracks

| Provider | Subscription / credit information | Local token history | CPU / RAM |
| --- | --- | --- | --- |
| Claude Code | OAuth 5-hour, weekly, and model-specific windows | `projects/**/*.jsonl` | CLI and descendants |
| Codex | CLI app-server rate-limit windows and plan | `sessions/**/*.jsonl`, OpenAI provider only | CLI and descendants |
| Grok | Included weekly/monthly credit percentage | `sessions/**/usage.json` | CLI and descendants |
| Kimi Code | Current and legacy quota response formats | Not collected | CLI and descendants |
| Fireworks | Live balance when the key has billing permission | Import Omarchy billing statistics | Not separately attributable |
| Pi | No single subscription quota: it is multi-provider | `sessions/**/*.jsonl` | CLI and descendants |
| Other agents | Import a display-ready Omarchy record | From that record | No automatic detection |

Each card has quota meters, reset countdowns, token counts, seven-day activity,
CPU/RAM, and expandable model statistics. A configurable threshold (90% by
default) marks high usage and sends an OS notification once per crossing/window.
Stale quota is dimmed and **does not trigger alerts**. Notification delivery
requires OS permission. Prepaid balances are displayed, not used for alerts.

### Credentials and paths

Use the provider's own CLI to sign in. This app doesn't implement login,
account switching, or token refresh. It never writes the providers' credential
files. Codex's own app-server may renew/write its login or initialize its
normal CLI state while servicing its read-only account RPC.

| Provider | Default source / environment override |
| --- | --- |
| Claude | `~/.claude/.credentials.json`; `CLAUDE_CONFIG_DIR`; default macOS login via the `Claude Code-credentials` Keychain service |
| Codex | `~/.codex`; `CODEX_HOME`; installed `codex` executable on PATH, or an absolute executable path in Settings |
| Grok | `~/.grok/auth.json`; `GROK_HOME` |
| Kimi | `KIMI_API_KEY`, then `~/.kimi-code/credentials/kimi-code.json`; `KIMI_CODE_HOME`; legacy `~/.kimi` only when no override is set |
| Fireworks | `FIREWORKS_API_KEY` + `FIREWORKS_ACCOUNT_ID`, or `~/.fireworks/auth.ini` (`api_key`, `account_id`) |
| Pi | `~/.pi/agent`; `PI_CODING_AGENT_DIR` |

The directory fields accept **absolute paths**, including paths with spaces.
No shell interpolation is performed. Environment-derived defaults are captured
on the first launch; saved settings then take precedence. Apps launched from a
GUI often do not inherit terminal PATH/API-key variables: launch from a terminal
or supply the Codex executable path in Settings. Custom Claude directories on
macOS use credential files, not guesses at alternate Keychain service names.
Expired Claude/Grok/Kimi tokens require starting the corresponding CLI again.

Fireworks' balance endpoint is permission-gated and often refuses ordinary API
keys. A refusal is shown honestly, not as zero balance. This port does **not**
reimplement the upstream estimated-spend billing crawler; import its record to
see estimated balances and account-global billing statistics instead.

### Omarchy interoperability

The original, MIT-licensed code is included in [`vendor/omarchy`](vendor/omarchy)
at a pinned commit. See [provenance and notices](THIRD_PARTY_NOTICES.md).

The app reads Omarchy's display-ready `*.json` records from
`$XDG_STATE_HOME/omarchy/agents/usage` (default
`~/.local/state/omarchy/agents/usage`). You can select a different directory,
including a read-only synced folder, or clear it to disable imports.

- Imported provider records **replace**, never add to, native provider totals.
- Unknown provider IDs appear automatically.
- Imported multi-account records show separate account meters without repeating
  top-level active-account limits or counting account statistics twice.
- Imports older than 30 minutes are marked stale. The app reads records only;
  run Omarchy's collector on the original machine to update them.
- Provider-local limits remain local. There is no cross-device summation,
  account switching, sign-in UI, or automatic sync in this version.

## Platforms and installation

| Platform | Integration | Distribution targets |
| --- | --- | --- |
| macOS | Menu-bar icon + percentage, Dock/window fallback | ARM64 and x64 DMG |
| Windows | Notification-area tray and normal window | ARM64 and x64 NSIS installer |
| Linux | StatusNotifier/AppIndicator-compatible tray and normal window; X11/Wayland | AppImage, DEB, RPM, tar.gz; build x64 or ARM64 |

No application can literally promise every Linux distro/hardware combination.
The Electron runtime requires a supported **64-bit glibc desktop environment**
and standard GTK/NSS/graphics libraries. Minimal/headless installs, 32-bit
systems, and musl-only Alpine are not supported out of the box. AppImage and
tar.gz cover distributions outside DEB/RPM, subject to those runtime libraries.
For current OS baselines consult [Electron's supported platforms](https://www.electronjs.org/docs/latest/tutorial/support#supported-platforms).

- **GNOME:** install an AppIndicator extension to show tray icons, or use the
  application window. Reopening the app/launcher raises the existing window.
- **Hyprland/Sway:** enable your bar's tray module. Pop-up positioning may be
  compositor-controlled under Wayland; the regular window is always available.
- **Linux AppImage:** some distributions require FUSE; extraction also works
  (`./Agent*.AppImage --appimage-extract` then `squashfs-root/AppRun`). Don't
  routinely disable Chromium's sandbox; use a packaged DEB/RPM where needed.
- **Windows:** the icon may be hidden in the tray overflow. Host process
  sampling depends on access to Windows' process information services.
- **macOS:** Keychain can request consent. Notifications may need enabling in
  System Settings. Custom-keychain Claude configurations are not auto-detected.

### Build installers

Build on the target OS for the most reliable toolchain:

```sh
npm run pack          # unpacked app for the current host architecture
npm run dist:mac      # ARM64 + x64 DMGs (on macOS)
npm run dist:win      # ARM64 + x64 NSIS installers (on Windows)
npm run dist:linux    # current architecture; AppImage, DEB, RPM, tar.gz
# Explicit Linux architectures:
npx electron-builder --linux --x64
npx electron-builder --linux --arm64
```

Outputs go to `release/` and are intentionally excluded from Git. Build scripts
have no publishing or auto-update step. macOS/Windows binaries are **unsigned**
unless you configure your own signing/notarization credentials with
[electron-builder](https://www.electron.build/code-signing). Expect OS warnings
for unsigned local builds. Do not disable system-wide security controls.

CI is configured to type-check, test, smoke-test Electron, and package on Ubuntu,
macOS, and Windows. Manual workflow runs or `v*` tags additionally build unsigned
installers. A local repository has no hosted CI until you push it to a remote.

## Accuracy, privacy, and performance

- Resources poll every **5 seconds**, local history every **15 seconds**, and
  provider quota every **5 minutes** (configurable). Manual quota refresh has a
  60-second floor to avoid provider rate limits.
- CPU is a percentage of **whole-machine capacity**, summed across matched
  agent processes and descendants. macOS uses `ps`'s lifetime CPU average,
  normalized by logical CPU count; Linux/Windows use interval-based counters
  after warm-up. It is not a measure of remote model compute or GPU use.
- RAM is summed resident memory. Shared pages may be counted more than once.
  Short-lived processes between polls and detached/reparented children can be
  missed. Only known CLI names or package entrypoints are matched; no arbitrary
  substring guessing. The monitor and its quota-probe descendants are excluded.
- Token totals cover **retained local files**, not provider invoices. Claude
  streaming messages and repeated Codex cumulative updates are deduplicated.
  Cached input and reasoning are not counted a second time. Pi is reported
  separately, even when it uses an Anthropic/OpenAI model.
- A file metadata cache avoids reparsing unchanged histories, in a worker off
  the UI thread. Scans don't follow nested symlinks. File/line/traversal limits
  prevent runaway scans and surface partial-total warnings. Missing homes are
  normal; unreadable or oversized sessions are reported.
- No telemetry, analytics, cloud account, local HTTP server, or persisted usage
  database. Only settings are written by the app, atomically with private POSIX
  file permissions (Windows inherits the user-profile ACL).
- Process command lines and transcript content are transient input. Only token
  metadata and aggregated metrics reach the renderer; credentials are neither
  displayed, logged, nor stored by this app.
- Network requests are made only after opt-in, to fixed HTTPS provider hosts.
  Direct quota HTTP calls reject redirects, enforce time/size limits, and retain
  stale results only for the same credential fingerprint. Codex uses its own
  CLI network/auth machinery. See [security details](docs/SECURITY.md).

## Development and verification

```sh
npm run check         # strict TypeScript, 51 unit/integration cases, production build
npm run test:smoke    # isolated real worker + real Electron UI tests, screenshots
npm audit             # runtime and development dependency audit
```

Linux CI runs smoke tests under `xvfb-run`. Tests use temporary fixtures rather
than your real accounts, and never need provider API keys. UI screenshots are
written to `.test-results/`. To test an unpacked/installed binary instead of the
development app, set `AUP_EXECUTABLE` to its executable when running
`node scripts/smoke.mjs` and `node scripts/host-smoke.mjs`.

See [architecture](docs/ARCHITECTURE.md) and [verification evidence](docs/VERIFICATION.md)
for what was actually executed locally versus configured for other platforms.

## License

MIT. The included upstream code retains Omarchy's original copyright and license.
