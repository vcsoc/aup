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
          ├── per-local-day token/cache/cost aggregates (all retained history)
          ├── model pricing (bundled/cache, explicit public-catalog refresh)
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
parsed usage events keyed by size and modification time. `jsonLines` streams a
finite snapshot of each regular file in 64 KiB chunks, buffering at most a 2 MiB
row plus the current chunk. There is no 128 MiB whole-session rejection: oversized
rows are skipped through the next newline, preserving usage on both sides, while
malformed rows are isolated. Sanitized coverage warnings are cached with events
and replayed on unchanged files, including Pi→Codex attribution. Only metadata
survives parsing. Calendar buckets are recomputed for every scan, so midnight
doesn't leave yesterday's counts in Today.
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

`src/main/pricing.ts` prefers recorded per-request USD, otherwise exact
provider/model list prices from a normalized, bundled models.dev catalog.
Separate input/output/cache components and context thresholds determine cost;
unknown models/breakdowns remain unpriced. Rates, identity, and coverage are
validated. Only explicit refresh requests download the fixed public endpoint;
no usage or credentials are sent. Public cache writes are atomic. Repricing
reuses parsed events and a generation change discards old in-flight results.

`Usage.history` contains only daily aggregates, not raw requests. The seven-day
chart is derived from it without limiting Stats to seven days. Shared pure
helpers in `src/shared/stats.ts` implement inclusive local dates, Monday–Sunday
weeks, DST-safe calendar shifts, provider/day summaries, and partial cost/cache
coverage. The renderer retains date/filter state across live updates and avoids
replacing focused date controls. The Today preset evaluates the current local
calendar date when clicked, not when the app started.

`src/shared/item-history.ts` implements item drill-down using the same daily
aggregates. Optional start/end dates filter before aggregation; blank endpoints
are unbounded. Days are merged by valid local date, then grouped into calendar
years/months or Monday-based weeks (not split at month/year boundaries). Group
and grand totals are computed independently from daily rows, never re-adding
parent totals or today's/lifetime counters. Unknown cache/cost coverage propagates.
Only retained rows are traversed; no date-span expansion or ten-year restriction
is needed. The renderer opens all-history weekly groups newest-first and provides
other grouping levels, reversible order, and expandable daily rows. Main Stats
range state remains independent. Selected item, filters, collapsed groups, focus,
and inner scroll survive snapshot updates; no new IPC, persistence, or network
capability is added. Pi/Codex backend attribution remains unchanged.

`src/shared/activity.ts` provides a nonmutating default provider order: running,
today's processed usage, latest observed request/prompt, recent volume, then
stable name/ID ties. `Usage.lastUsedAt` is optional metadata projected from real
events, never inferred from refreshed file mtimes. Imported nonzero day buckets
provide date-only recency. Future/invalid activity timestamps are ignored for
ranking; CPU/RAM samples do not affect it. Filters and provider selection retain
the activity order; Stats ranks providers by the selected period's volume.

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
The macOS bundle sets `LSUIElement: true`, avoiding a Dock icon at launch.
`src/main/dock.ts` also hides the Dock icon at runtime once tray creation succeeds
(including development), without hiding the panel. Failed tray setup destroys any
partial item and restores the native Dock for access; Windows/Linux are unchanged.
The app never changes Dock pins or other desktop preferences automatically.
`src/main/startup.ts` reconciles the default-on login preference using native
macOS/Windows login items or an atomic, escaped XDG `.desktop` entry on Linux.
Linux AppImages register their persistent image rather than the transient mount.
Windows/Linux use `--startup`; macOS checks the native login-launch flag. Login
launches remain hidden if a tray is available. Startup registration is disabled
for unpackaged, demo, and smoke runs; OS refusal is surfaced, not swallowed.

`src/main/tray-menu.ts` keeps the macOS menu unattached: AppKit otherwise opens
it on left-click as well. Only `right-click` explicitly pops that menu; the
existing left-click handler exclusively toggles the panel. Windows/Linux keep
native menu attachment (required for Linux StatusNotifier integration).

`src/main/window-chrome.ts` uses macOS `titleBarStyle: hidden` with native
traffic lights at (10, 11) inside the renderer's 36px header. The title strip is
removed without replacing OS controls or adding window-action IPC. Platform-
scoped CSS reserves 80px, marks header whitespace draggable, excludes interactive
controls from dragging, and keeps Settings below the native buttons. Other OSes
retain their standard frame. Content fitting continues to use actual content
bounds, which now equal outer window bounds on macOS.

The main process restarts failed workers at most three times. It never starts a
shell or a local web server. `assets/preload.cjs` exposes nine fixed request
capabilities and one snapshot subscription. New capabilities request a fixed
public price refresh or a bounded numeric content height—not arbitrary window
options, files, or URLs. A ResizeObserver requests content fitting; the host
clamps to the current display work area, preserves width, and leaves maximized
or fullscreen windows alone.

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
