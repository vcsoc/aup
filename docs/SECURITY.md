# Security and privacy

## Threat model

The renderer and imported records are treated as untrusted. This app is a
read-mostly local monitor, not a credential manager or an agent execution service.
A malicious process already running as your user can read most of the same CLI
files; this app does not protect those files from other local applications.

- Electron renderer: sandbox on, Node integration off, context isolation on.
- Preload: fixed request methods, no arbitrary channel, path, URL, or shell API.
- IPC: validates the sender WebContents, main frame, exact local page URL, and
  settings schema. New-window requests and navigation are denied.
- Local page only, with no renderer networking, remote resources, or web server.
- Provider-supplied names, models, plans, and status strings are escaped before
  rendering. Imported IDs, counts, percentages, and balances are normalized.
- Automatic update and publishing are intentionally absent. Builds are unsigned
  unless the operator configures signing and notarization.

## Data handling

Local history and process sampling are enabled initially because monitoring is
the app's purpose. Both are independently switchable. Imported record access is
independent: clear its directory to disable it as well.

Full transcript lines must be parsed to find usage metadata. Full process rows
must be read to attribute runtime entrypoints and descendants. These raw inputs
are transient and never stored, sent to the renderer, exported, or logged.
Only usage metadata is cached in memory. JavaScript memory is garbage-collected,
not a secure zeroization facility. Settings can reveal local directory names and
are saved under the app's normal user-data directory. Explicit price updates
also persist a normalized **public model-price catalog** there; daily usage and
cost aggregates remain memory-only.

The installed app enables login startup by default. This writes only its own
native macOS/Windows login item or Linux XDG autostart entry; Settings can remove
it. No system-wide service, privilege escalation, watchdog, or scheduled task is
installed. Demo, development, and smoke sessions never register startup items.
OS policy can override this preference. Linux executable paths are quoted and
escaped as desktop-entry arguments (including percent field codes); no shell
command is used.

Demo mode starts no monitoring worker, makes no credential/usage/process reads,
and doesn't persist settings. Like any Electron app, Chromium may still write
ordinary runtime/cache files in its profile; "no usage persistence" does not mean
"no disk writes anywhere."

## Networking and authentication

**Stats → Update prices** separately authorizes a public request to the fixed
`https://models.dev/api.json` endpoint. It carries no credentials, prompts,
usage, model selection, or account IDs. Node fetch rejects redirects, times out
after 15 seconds, and bounds response buffering at 16 MiB. Only known numeric
rates/context tiers are accepted; cached catalogs are bounded at 8 MiB and must
identify the same fixed source. Errors preserve the previous catalog. There is
no automatic pricing request, and demo mode cannot start one. This permission
does not enable authenticated provider quota checks.

The renderer can request only a finite bounded content height, clamped by the
host to the display work area. It cannot send arbitrary window options or
position instructions. All new IPC still requires the exact trusted main frame.

Network quota checks default off. Opting in authorizes direct HTTPS calls to:

- `api.anthropic.com` — Claude OAuth usage
- `cli-chat-proxy.grok.com` — Grok credit usage
- `api.kimi.com` — Kimi Code quotas
- `api.fireworks.ai` — Fireworks balance

Direct requests send the respective provider credential only in an Authorization
header to fixed host constants. Redirects are rejected, requests time out after
10 seconds, and responses are capped at 1 MiB. Provider response bodies and raw
errors aren't displayed. There are no configurable endpoint overrides.

Codex is different: the installed CLI's app-server handles its own credentials,
network destinations (including its configuration), and login refresh. Only
initialize, initialized, and account/rateLimits/read frames are sent; no thread,
command execution, or conversation RPC is called. Its normal startup can write
CLI state or synchronize plugins. The panel trusts the executable you explicitly
configure or the one found on your PATH; don't configure an untrusted program.

Claude's default macOS credentials can be read through the fixed Keychain service
`Claude Code-credentials` after opt-in. The OS may prompt for permission. Custom
Claude homes use their credential files instead. Expired tokens are not refreshed
by the app. No stored credentials are edited. Already-started quota requests may
finish during the short interval after you turn network checks off; their old
generation's display results are discarded.

There are no real-account network tests in the automated suite. Unit tests use
mocked transport and fixtures. Quota APIs are vendor-controlled and can change
without notice; unavailable/unsupported data is reported rather than invented.

## Scan bounds and residual limitations

JSON imports/credentials are capped at 4 MiB; ancillary text at 1 MiB. Session
JSONL files are capped at 128 MiB, individual lines at 2 MiB. A traversal admits at
most 20,000 files and 100,000 directory entries, at most 12 nested directory
levels. Nested symlinks aren't followed. Configured root directories are trusted
user choices and can themselves be symlinks; filesystem races aren't a security
boundary against other processes running as the same user. Large histories can
still consume significant memory because projected events are cached.

Provider tokens are fingerprinted for cache identity, never written by the app.
Codex keyring identity isn't observable without the CLI: file/config identity and
the next scheduled CLI probe determine when an externally switched account is
reflected. A previously known quota may stay visible until the next poll. Its
reset time and stale label should be considered before relying on it.

Report vulnerabilities privately to the repository maintainer once a remote and
contact are established. Don't attach credential files or real transcript bodies
to public issues.
