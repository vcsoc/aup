# Architecture

```text
OS tray/menu bar + normal desktop window
             │
      Electron main process
      ├── settings (validated, atomic JSON)
      ├── tray state + threshold notifications
      ├── login startup (native macOS/Windows, XDG Linux)
      ├── exact-sender IPC capability checks
      └── monitoring worker thread
          ├── usage scanner (15s, metadata cache)
          │   ├── Claude transcript request deduplication
          │   ├── Codex native OpenAI rollout counters
          │   ├── Grok completed-turn ledger
          │   └── Pi response deduplication + OpenAI Codex attribution
          ├── quota collector (per-provider cache)
          │   ├── fixed-host HTTPS, opt-in only
          │   └── Codex line-delimited app-server RPC
          ├── process table (5s, provider/descendant attribution)
          └── Omarchy record importer (15s)
             │
      projected snapshot over IPC
             │
      sandboxed preload (fixed API)
             │
      local renderer (TypeScript + CSS, no framework)
```

## Important boundaries

`src/shared/types.ts` defines the snapshot contract. It contains display data,
not credentials, transcript bodies, raw command lines, or filesystem access.

`src/main/worker.ts` performs collection. Per-file cache entries store only
parsed usage events keyed by size and modification time. It recomputes calendar
buckets for every scan, so midnight doesn't leave yesterday's counts in Today.
Settings changes invalidate usage caches and clear the display immediately. A
generation check discards old in-flight results. Resource sampling is independent
of quota requests and scanning, so a slow provider doesn't freeze the renderer.

Usage is grouped by backend rather than blindly summed by harness: Pi messages
with provider `openai-codex` join the Codex event bucket before deduplication.
Other Pi providers stay in Pi. Full provider response identities are hashed in
the worker (never truncated or sent to the renderer); copied Pi entry IDs plus
timestamp are a fallback. Distinct requests sharing a subscription are not
collapsed. Native Codex logs lacking a shared response ID cannot establish
cross-harness identity. Snapshot `sources` are display-only daily aggregates.
`todayTokens`, charts, and model history remain cache-inclusive; the renderer
shows `todayTokens - todayCachedTokens` as **Uncached today** only when all
nonempty sources have a known breakdown. Missing cache data stays unknown.
Pi resource attribution is unchanged and never counted again under Codex.

`src/main/quotas.ts` binds cache identity to the selected home and credentials.
Only successful checks advance `at`; failures retain the same identity's last
successful numbers and mark them stale. Provider errors are sanitized, not raw
response bodies. Cache is memory-only and cleared when settings change. A
manual request doesn't bypass the one-minute provider cooldown.

`src/main/rpc.ts` locates the Codex executable without shell interpolation,
initializes the app-server, and requests `account/rateLimits/read`. It handles
multiple JSON frames per read and fragmented frames, drains stderr without
saving it, caps response buffering, and tears down the probe process group/tree.
Windows npm `.cmd` shims are resolved to the CLI's JS entrypoint and run under
Electron's Node mode; explicit `.exe` paths are also supported.

`src/main/processes.ts` matches native CLI names and known runtime entrypoints,
then walks parent relationships. Each PID belongs to at most one provider. Known
nested agents belong to their nearest agent root, and excluded monitoring/probe
trees cannot accidentally count themselves. RSS is converted from KiB to bytes.
macOS CPU scale is normalized to machine capacity; its `ps` averaging semantics
remain different from Linux/Windows interval counters.

`src/main/imports.ts` accepts only bounded display-ready JSON, projects known
fields, rejects unsafe provider IDs, and normalizes percentages. An imported
provider replaces the native record. Imported accounts receive their own limits
but not another copy of the provider's usage. Unknown providers need no UI edits.

`src/main/main.ts` owns windows, the tray, notifications, IPC, and worker lifecycle.
`src/main/startup.ts` reconciles the default-on login preference using native
macOS/Windows login items or an atomic, escaped XDG `.desktop` entry on Linux.
Linux AppImages register their persistent image rather than the transient mount.
Windows/Linux use `--startup`; macOS checks the native login-launch flag. Login
launches remain hidden if a tray is available. Startup registration is disabled
for unpackaged, demo, and smoke runs; OS refusal is surfaced, not swallowed.

The main process restarts failed workers at most three times. It never starts a shell or a local
web server. `assets/preload.cjs` exposes only seven request capabilities and one
snapshot subscription to a context-isolated, sandboxed renderer.

The renderer uses escaped text at all HTML insertion points. Its CSP disables
connections, external scripts, objects, base URL replacement, and form submission.
A session request filter also denies renderer HTTP(S) requests. There are no
remote fonts, CDNs, or remote pages.

## Deliberate differences from Omarchy

The original QML shell panel and POSIX collectors are kept verbatim under
`vendor/omarchy/`, not used as runtime dependencies. This application adds
cross-platform process metrics and a portable Electron UI. It does not port
account management, automatic account switching, agent launching, arbitrary
command collectors, cloud sync, opencode database scanning, or Fireworks' billing
crawler. Those Omarchy-specific capabilities aren't needed to display usage;
existing Omarchy records can supply additional provider/account data.

## Extending

- For another record-producing tool, write one Omarchy-compatible JSON file into
  the selected import directory. Use an atomic rename to publish updates.
- For a native provider, extend the provider ID/name mapping, settings schema,
  collector and tests. Keep credential parsing and networking in the worker.
- To add process matching, require a concrete executable or known package
  entrypoint, with false-positive and descendant-attribution tests.

Don't execute scripts named by imported records, expose arbitrary IPC channels,
or accept renderer-provided network endpoints.
