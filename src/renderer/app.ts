import './style.css';
import { providerIds, names, type Agent, type PanelAPI, type Settings, type Snapshot, type CostSummary } from '../shared/types';
import { tokenTotals } from '../shared/usage';
import { sortAgents } from '../shared/activity';
import { costLabel, rangeError, rangeStats, shiftRange, todayRange, unknownCost, weekRange } from '../shared/stats';
import { groupedHistory, type HistoryGrouping } from '../shared/item-history';
declare global { interface Window { panel: PanelAPI } }
const api = window.panel;
const app = document.querySelector<HTMLDivElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!;
let snapshot: Snapshot; let settings: Settings;
let filter: 'all' | 'running' | 'attention' = 'all';
let refreshing = false; let expanded = new Set<string>();
let view: 'live' | 'stats' = 'live'; let statsMode: 'providers' | 'days' = 'providers';
let range = weekRange(); let statsProvider = 'all'; let priceRequest = false; let priceError = '';
let historyItem: string | null = null; let historyRange = { from: '', to: '' };
let historyGrouping: HistoryGrouping = 'week'; let historyDescending = true; const collapsedGroups = new Set<string>();
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const memory = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
const age = (time: number) => !time ? 'not yet checked' : Date.now() - time < 60000 ? 'just now' : `${Math.floor((Date.now() - time) / 60000)}m ago`;
function reset(time: string): string {
  const ms = Date.parse(time) - Date.now(); if (!Number.isFinite(ms)) return 'reset unknown';
  if (ms <= 0) return 'reset due · awaiting check';
  const minutes = Math.ceil(ms / 60000);
  return minutes >= 1440 ? `resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h` : minutes >= 60 ? `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `resets in ${minutes}m`;
}
const urgent = (agent: Agent) => agent.stale || agent.warnings.length > 0 || agent.limits.some(limit => limit.percent * 100 >= settings.threshold);
const robot = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v4M1 12v4M23 12v4M8 13v2M16 13v2M9 18h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const glyphs: Record<string, string> = { claude: '✳', codex: '⌘', grok: '𝕏', kimi: 'K', fireworks: '✷', pi: 'π' };
function costDescription(cost: CostSummary): string {
  const basis = [cost.recorded ? 'recorded usage cost' : '', cost.estimated ? 'current list-price estimate' : ''].filter(Boolean).join(' + ') || (cost.unpricedTokens ? 'price unavailable' : 'no recorded usage');
  return `USD · ${basis}${cost.unpricedTokens ? ` · ${compact(cost.unpricedTokens)} tokens unpriced; total is incomplete` : ''}. Not your subscription bill.`;
}
function statsView(): string {
  const error = rangeError(range);
  const stats = rangeStats(snapshot.agents, range, statsProvider);
  const total = stats.total;
  const warnings = [...new Set(snapshot.agents.filter(agent => statsProvider === 'all' || agent.id === statsProvider).flatMap(agent => agent.warnings))];
  const tabs = `<div class="stats-tabs" role="tablist" aria-label="Statistics breakdown">${(['providers', 'days'] as const).map(mode => `<button role="tab" id="stats-${mode}" data-stats-mode="${mode}" aria-selected="${statsMode === mode}" aria-controls="stats-table" tabindex="${statsMode === mode ? 0 : -1}">${mode === 'providers' ? 'Providers' : 'Days'}</button>`).join('')}</div>`;
  const row = (item: typeof total) => `<tr>${statsMode === 'days' ? `<td>${escape(item.date)}</td>` : ''}<th scope="row">${item.id === 'empty' ? escape(item.name) : `<button class="history-link" data-history-item="${escape(item.id)}" title="View all retained history for ${escape(item.name)}">${escape(item.name)}</button>`}</th><td title="Processed tokens, including cached reads">${compact(item.tokens)}</td>${statsMode === 'providers' ? `<td>${item.cachedTokens === undefined ? '—' : compact(item.tokens - item.cachedTokens)}</td>` : ''}<td class="cost-value" title="${escape(costDescription(item.cost))}">${costLabel(item.cost)}</td></tr>`;
  return `<section id="stats-panel" role="tabpanel" aria-labelledby="view-stats">
    <div class="range-nav"><strong>Usage history</strong><div><button id="previous-week" aria-label="Previous week" title="Move both dates back seven days">‹</button><button id="stats-today" title="Show today's activity only">Today</button><button id="current-week">This week</button><button id="next-week" aria-label="Next week" title="Move both dates forward seven days">›</button></div></div>
    <div class="date-fields"><label>From<input type="date" id="stats-from" value="${escape(range.from)}" required></label><label>To<input type="date" id="stats-to" value="${escape(range.to)}" required></label></div>
    ${error ? `<p class="warning" role="alert">${escape(error)}</p>` : `<section class="summary-grid stats-summary" aria-label="Selected range totals"><div class="summary-cell metric-tokens"><span>Processed</span><strong>${compact(total.tokens)}</strong></div><div class="summary-cell metric-tokens"><span>Uncached</span><strong>${total.cachedTokens === undefined ? '—' : compact(total.tokens - total.cachedTokens)}</strong></div><div class="summary-cell cost-value" title="${escape(costDescription(total.cost))}"><span>Cost · USD</span><strong>${costLabel(total.cost)}</strong></div></section>`}
    <div class="stats-controls">${tabs}<label class="sr-only" for="stats-provider">Provider</label><select id="stats-provider" aria-label="Provider"><option value="all">All providers</option>${sortAgents(snapshot.agents).map(agent => `<option value="${escape(agent.id)}" ${statsProvider === agent.id ? 'selected' : ''}>${escape(agent.name)}</option>`).join('')}</select></div>
    <div class="stats-scroll" id="stats-table" tabindex="0" role="tabpanel" aria-labelledby="stats-${statsMode}"><table><caption class="sr-only">${statsMode === 'providers' ? 'Provider totals' : 'Daily provider totals'} from ${escape(range.from)} through ${escape(range.to)}</caption><thead><tr>${statsMode === 'days' ? '<th scope="col">Date</th>' : ''}<th scope="col">Provider</th><th scope="col">Tokens</th>${statsMode === 'providers' ? '<th scope="col">Uncached</th>' : ''}<th scope="col">Cost USD</th></tr></thead><tbody>${(statsMode === 'providers' ? stats.providers : stats.days).map(row).join('') || `<tr><td colspan="4">${error ? 'Correct the dates to see totals.' : 'No retained usage in this range.'}</td></tr>`}</tbody><tfoot><tr>${statsMode === 'days' ? '<td></td>' : ''}<th scope="row">Total</th><td>${compact(total.tokens)}</td>${statsMode === 'providers' ? `<td>${total.cachedTokens === undefined ? '—' : compact(total.tokens - total.cachedTokens)}</td>` : ''}<td title="${escape(costDescription(total.cost))}">${costLabel(total.cost)}</td></tr></tfoot></table></div>
    <p class="stats-note">Inclusive local dates · full week = Mon–Sun. Tokens include cache reads. Costs use recorded USD where available, otherwise current model list prices—not additional subscription charges.</p>
    ${warnings.length ? `<p class="warning" role="status">Partial history: ${warnings.map(escape).join(' ')}</p>` : ''}
    ${total.cost.unpricedTokens ? `<p class="warning">${compact(total.cost.unpricedTokens)} tokens have no usable price or breakdown. “+” means a partial cost; “—” means unknown.</p>` : ''}
    <p class="stats-note">Retained local history only. Missing/oversized files are partial; imported records may expose only seven days. No history is invented for missing dates.</p>
    <div class="pricing-footer"><span>models.dev · ${snapshot.pricing?.fetchedAt ? escape(new Date(snapshot.pricing.fetchedAt).toLocaleDateString()) : 'no catalog'} · ${compact(snapshot.pricing?.models || 0)} models</span><button id="update-prices" ${snapshot.demo || priceRequest || snapshot.pricing?.updating ? 'disabled' : ''} title="Fetch public model prices from models.dev; no credentials or usage are sent">${priceRequest || snapshot.pricing?.updating ? 'Updating…' : 'Update prices'}</button></div>
    ${priceError || snapshot.pricing?.error ? `<p class="warning" role="status">${escape(priceError || snapshot.pricing?.error)}</p>` : ''}
  </section>`;
}
function itemHistoryView(agent: Agent): string {
  const stats = groupedHistory(agent.usage, historyRange, historyGrouping, historyDescending);
  const total = stats.total;
  const values = (item: typeof total) => `<td class="metric-tokens" title="${item.tokens.toLocaleString()} processed tokens">${compact(item.tokens)}</td><td class="metric-tokens" title="Uncached tokens">${item.cachedTokens === undefined ? '—' : compact(item.tokens - item.cachedTokens)}</td><td class="cost-value" title="${escape(costDescription(item.cost))}">${costLabel(item.cost)}</td>`;
  const rows = stats.groups.map(group => {
    const key = `${historyGrouping}:${group.key}`;
    const open = !collapsedGroups.has(key);
    const days = group.days.map(day => `<tr class="history-day" data-date="${day.date}"><th scope="row"><time datetime="${day.date}">${day.date}</time></th>${values(day)}</tr>`).join('');
    return historyGrouping === 'day' ? days : `<tr class="history-group" data-history-period="${group.key}"><th scope="row"><button id="history-period-${key}" class="history-link" data-history-group="${key}" aria-expanded="${open}" title="Toggle daily usage for ${escape(group.label)}">${open ? '▾' : '▸'} ${escape(group.label)}</button></th>${values(group.total)}</tr>${open ? days : ''}`;
  }).join('');
  return `<section id="stats-panel" aria-labelledby="item-history-title">
    <div class="range-nav history-heading"><h2 id="item-history-title" tabindex="-1">${escape(agent.name)} history</h2><button id="history-back">‹ All stats</button></div>
    <div class="date-fields"><label>From (optional)<input type="date" id="history-from" value="${escape(historyRange.from)}"></label><label>To (optional)<input type="date" id="history-to" value="${escape(historyRange.to)}"></label></div>
    <div class="history-controls"><label for="history-group">Group by<select id="history-group">${(['day', 'week', 'month', 'year'] as const).map(group => `<option value="${group}" ${historyGrouping === group ? 'selected' : ''}>${{ day: 'Days', week: 'Weeks', month: 'Months', year: 'Years' }[group]}</option>`).join('')}</select></label><button id="history-sort" title="Reverse chronological order">${historyDescending ? 'Newest first ↓' : 'Oldest first ↑'}</button><button id="history-clear">All dates</button></div>
    ${stats.error ? `<p class="warning" role="alert">${escape(stats.error)}</p>` : `<section class="summary-grid stats-summary" aria-label="Item history totals"><div class="summary-cell metric-tokens"><span>Processed</span><strong>${compact(total.tokens)}</strong></div><div class="summary-cell metric-tokens"><span>Uncached</span><strong>${total.cachedTokens === undefined ? '—' : compact(total.tokens - total.cachedTokens)}</strong></div><div class="summary-cell cost-value" title="${escape(costDescription(total.cost))}"><span>Cost · USD</span><strong>${costLabel(total.cost)}</strong></div></section>`}
    <div class="stats-scroll item-history-table" data-scroll-key="${escape(agent.id)}-${historyGrouping}-${historyRange.from}-${historyRange.to}-${historyDescending}" tabindex="0"><table><caption class="sr-only">${escape(agent.name)} daily usage, grouped by ${historyGrouping}, ${historyDescending ? 'newest' : 'oldest'} first. Inclusive dates: ${escape(historyRange.from || 'earliest retained')} through ${escape(historyRange.to || 'latest retained')}.</caption><colgroup><col style="width:44%"><col><col><col></colgroup><thead><tr><th scope="col">${historyGrouping === 'day' ? 'Date' : 'Period / day'}</th><th scope="col">Tokens</th><th scope="col">Uncached</th><th scope="col">Cost USD</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${stats.error ? 'Correct the dates to see totals.' : 'No retained usage in this range.'}</td></tr>`}</tbody><tfoot><tr><th scope="row">Total</th>${values(total)}</tr></tfoot></table></div>
    ${agent.usageNote ? `<p class="stats-note">${escape(agent.usageNote)} ${agent.id === 'pi' && snapshot.agents.some(item => item.id === 'codex') ? '<button class="history-link" data-history-item="codex">View Codex history ↗</button>' : ''}</p>` : ''}
    ${agent.warnings.length ? `<p class="warning" role="status">Partial history: ${agent.warnings.map(escape).join(' ')}</p>` : ''}
    ${total.cost.unpricedTokens ? `<p class="warning">${compact(total.cost.unpricedTokens)} tokens unpriced. “+” = partial cost; “—” = unknown.</p>` : ''}
    <p class="stats-note">Inclusive local dates; blank dates include all retained history. Weeks = Mon–Sun, including weeks across month/year boundaries. Each period total includes only the filtered days; the grand total counts every day once. Expand/collapse a period to see its days.</p>
    <p class="stats-note">Tokens include cache reads. Costs use recorded USD or current list-price estimates, not subscription bills. Missing local history and limited imports remain partial; no history is invented.</p>
  </section>`;
}
function card(agent: Agent): string {
  const running = agent.resources.processes > 0;
  const tokens = tokenTotals([agent.usage]);
  const tokenLabel = tokens.uncached === undefined ? 'Today' : 'Uncached';
  const tokenTitle = tokens.uncached === undefined ? 'Processed tokens today; cache breakdown unavailable' : `${compact(tokens.uncached)} uncached + ${compact(tokens.cached!)} cached input = ${compact(tokens.processed)} processed today. Not subscription quota.`;
  const isUrgent = urgent(agent);
  const cost = agent.usage.todayCost || unknownCost(agent.usage.todayTokens);
  const max = Math.max(0, ...agent.usage.days.map(day => day.tokens));
  const models = Object.entries(agent.usage.models).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return `<article class="agent-card ${agent.stale ? 'stale' : ''}" data-agent="${escape(agent.id)}">
    <div class="agent-heading">
      <div class="agent-mark mark-${escape(agent.id.split('/')[0])}" aria-hidden="true">${glyphs[agent.id.split('/')[0]] || '◈'}</div>
      <div class="agent-identity"><h2 title="${escape(agent.name)}${agent.plan ? ` · ${escape(agent.plan)}` : ''}"><button id="history-open-${escape(agent.id)}" class="history-link" data-history-item="${escape(agent.id)}" title="View usage and cost history for ${escape(agent.name)}">${escape(agent.name)}</button></h2><span class="agent-cost" aria-label="Today's cost ${costLabel(cost)}" title="Today's cost: ${escape(costDescription(cost))}">${cost.estimated ? '≈' : ''}${costLabel(cost)}</span></div>
      <span class="quota-inline" title="${escape(agent.usageNote || agent.quotaStatus)}">${!agent.limits.length && !agent.balance ? (agent.usageNote ? 'Usage ↗ Codex' : escape(agent.quotaStatus)) : escape(agent.plan)}</span>
      <span class="status-pill ${running ? 'running' : ''}">${running ? '<i></i> Running' : 'Idle'}</span>
    </div>
    ${agent.limits.length || agent.balance ? '<div class="quota-area">' : ''}
      ${agent.limits.map(limit => {
        const percent = Math.round(limit.percent * 100); const high = percent >= settings.threshold;
        return `<div class="quota-row ${high ? 'high' : ''}" title="${escape(limit.label)}: ${percent}% used · ${escape(reset(limit.resetsAt))}${agent.stale ? ' · stale' : ''}">
        <span class="quota-label">${escape(limit.label)}</span>
        <div class="meter" role="progressbar" aria-label="${escape(limit.label)} quota used" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>
        <strong class="quota-percent">${percent}%</strong><span class="quota-reset" title="${escape(limit.resetsAt)}">${escape(reset(limit.resetsAt))}</span></div>`;
      }).join('')}
      ${agent.balance ? `<div class="balance"><span>${agent.balance.estimated ? 'Estimated credit' : 'Remaining credit'}</span><strong>${escape(agent.balance.currency)} ${agent.balance.remaining.toFixed(2)}</strong></div>` : ''}
    ${agent.limits.length || agent.balance ? '</div>' : ''}
    ${agent.stale ? `<p class="quota-status warning" title="${escape(agent.quotaStatus)}">Stale quota · ${age(agent.quotaAt)}</p>` : ''}
    <div class="agent-stats"><div class="daily-tokens metric-tokens" title="${escape(tokenTitle)}"><span>${agent.usageNote && !tokens.processed ? 'Usage' : tokenLabel}</span><strong>${agent.usageNote && !tokens.processed ? '↗ Codex' : compact(tokens.uncached ?? tokens.processed)}</strong></div>
    <div class="spark" aria-label="Processed tokens including cache reads over the last seven days">${agent.usage.days.map(day => `<span style="height:${max ? Math.max(4, day.tokens / max * 100) : 4}%" title="${escape(day.date)}: ${compact(day.tokens)} tokens"></span>`).join('')}</div>
    <div class="resource-inline" title="Agent processes and descendants; CPU is machine capacity, RAM is summed resident memory"><strong class="metric-cpu">${agent.resources.cpu.toFixed(1)}<small>% CPU</small></strong><span class="metric-ram">${memory(agent.resources.memory)} RAM</span></div></div>
    <details data-details="${escape(agent.id)}" ${expanded.has(agent.id) ? 'open' : ''}><summary title="Details for ${escape(agent.name)}">${isUrgent ? '<span class="attention-dot"></span>' : ''}<span class="sr-only">Details for ${escape(agent.name)}</span><span class="detail-toggle" aria-hidden="true">＋</span></summary>
      <div class="detail-content"><p class="quota-detail ${agent.stale ? 'warning' : ''}">${escape(agent.quotaStatus)} · ${age(agent.quotaAt)}</p>${agent.usageNote ? `<p class="detail-note">${escape(agent.usageNote)}</p>` : ''}<dl><dt>Cost today · USD</dt><dd title="${escape(costDescription(cost))}">${costLabel(cost)}</dd><dt>Recorded cost component</dt><dd>${cost.recorded ? 'Included' : 'None'}</dd><dt>List-price estimates</dt><dd>${cost.estimated ? 'Included' : 'None'}</dd><dt>Unpriced tokens today</dt><dd>${compact(cost.unpricedTokens)}</dd><dt>Plan</dt><dd>${escape(agent.plan || 'Unknown')}</dd><dt>Processed today</dt><dd>${compact(tokens.processed)}</dd><dt>Cached input today</dt><dd>${tokens.cached === undefined ? 'Unknown' : compact(tokens.cached)}</dd><dt>Uncached today</dt><dd>${tokens.uncached === undefined ? 'Unknown' : compact(tokens.uncached)}</dd><dt>Recorded tokens</dt><dd>${compact(agent.usage.totalTokens)}</dd><dt>Prompts today</dt><dd>${agent.usage.prompts}</dd><dt>Recorded sessions</dt><dd>${agent.usage.sessions}</dd><dt>Active processes</dt><dd>${agent.resources.processes}</dd><dt>Data source</dt><dd>${escape(agent.source)}</dd></dl>
      ${Object.keys(agent.usage.sources || {}).length ? `<h3>Today's sources · processed tokens</h3>${Object.entries(agent.usage.sources!).map(([source, count]) => `<div class="model-row"><span>${escape(source)}</span><strong>${compact(count)}</strong></div>`).join('')}` : ''}
      ${models.length ? `<h3>Models · recorded tokens</h3>${models.map(([model, tokens]) => `<div class="model-row"><span>${escape(model)}</span><strong>${compact(tokens)}</strong></div>`).join('')}` : ''}
      ${agent.warnings.map(warning => `<p class="warning">${escape(warning)}</p>`).join('')}
      <p class="detail-note">Uncached = input + output excluding cache reads. Processed totals, charts, and model history include cache reads once per request; cached context is shown separately from uncached input/output. Local history is not subscription quota or a billing ledger. Pi/OpenAI Codex requests belong to Codex. Imports replace native figures, never add to them.</p></div>
    </details>
  </article>`;
}
function render(): void {
  document.documentElement.dataset.platform = snapshot.platform;
  const focus = (document.activeElement as HTMLElement)?.id;
  const scroll = window.scrollY;
  const historyTable = app.querySelector<HTMLElement>('.item-history-table');
  const historyScroll = historyTable?.scrollTop || 0; const historyScrollKey = historyTable?.dataset.scrollKey;
  const totals = snapshot.agents.reduce((sum, agent) => ({ cpu: sum.cpu + agent.resources.cpu, memory: sum.memory + agent.resources.memory, processes: sum.processes + agent.resources.processes }), { cpu: 0, memory: 0, processes: 0 });
  const tokens = tokenTotals(snapshot.agents.map(agent => agent.usage));
  const tokenTitle = tokens.uncached === undefined ? `${compact(tokens.processed)} processed today; cache breakdown unavailable for one or more sources` : `${compact(tokens.uncached)} uncached + ${compact(tokens.cached!)} cached input = ${compact(tokens.processed)} processed today. Not subscription quota.`;
  const agents = sortAgents(snapshot.agents).filter(agent => filter === 'all' || (filter === 'running' ? agent.resources.processes > 0 : urgent(agent)));
  if (statsProvider !== 'all' && !snapshot.agents.some(agent => agent.id === statsProvider)) statsProvider = 'all';
  const historyAgent = snapshot.agents.find(agent => agent.id === historyItem);
  if (!historyAgent) historyItem = null;
  app.innerHTML = `<header class="topbar"><a class="brand" href="#" aria-label="Agent Usage Panel home"><span class="brand-icon">${robot}</span><span>agent usage<span class="brand-suffix"> / panel</span></span></a>
    ${snapshot.demo ? '<span class="demo-badge" title="Sample data only. No credentials, histories, or processes are read.">DEMO MODE</span>' : ''}
    <div class="header-actions"><button id="refresh" class="icon-button" aria-label="Refresh usage" title="${snapshot.scanning ? 'Checking usage…' : 'Refresh usage (R)'}" aria-busy="${snapshot.scanning}" ${refreshing || snapshot.scanning ? 'disabled' : ''}><svg class="${snapshot.scanning ? 'spin' : ''}" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16 8a6.2 6.2 0 1 0 .1 4M16 3v5h-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button id="settings" class="icon-button" aria-label="Settings" title="Settings">⚙</button></div></header>
    <main><h1 class="sr-only">Agent Usage Panel</h1>
    ${snapshot.errors.map(error => `<div class="notice" role="status">${escape(error)}</div>`).join('')}
    ${view === 'live' ? `<section class="summary-grid" aria-label="Usage summary"><div class="summary-cell metric-tokens" title="${escape(tokenTitle)}"><span>${tokens.uncached === undefined ? 'Processed today' : 'Uncached today'}</span><strong>${compact(tokens.uncached ?? tokens.processed)}</strong>${tokens.cached === undefined ? '<small>cache unknown</small>' : ''}</div>
    <div class="summary-cell metric-cpu" title="${settings.processEnabled ? `${totals.processes} active agent processes · whole-machine CPU capacity` : 'Process monitoring disabled'}"><span>CPU</span><strong>${settings.processEnabled ? totals.cpu.toFixed(1) + '%' : '—'}</strong></div>
    <div class="summary-cell metric-ram" title="Summed resident memory, not GPU"><span>RAM</span><strong>${settings.processEnabled ? memory(totals.memory) : '—'}</strong></div></section>` : ''}
    <div class="section-toolbar">${view === 'live' ? `<div class="filters" role="group" aria-label="Filter agents">${(['all', 'running', 'attention'] as const).map(key => `<button id="filter-${key}" data-filter="${key}" ${key === 'attention' ? 'aria-label="Needs attention" title="Needs attention"' : ''} class="${filter === key ? 'selected' : ''}" aria-pressed="${filter === key}">${key === 'all' ? 'All agents' : key === 'running' ? 'Running' : 'Attention'}${key === 'all' ? `<span>${snapshot.agents.length}</span>` : ''}</button>`).join('')}</div>` : '<span class="stats-heading">Statistics</span>'}<div class="view-tabs" role="tablist" aria-label="Panel views">${(['live', 'stats'] as const).map(tab => `<button role="tab" id="view-${tab}" data-view="${tab}" aria-selected="${view === tab}" aria-controls="${tab}-panel" tabindex="${view === tab ? 0 : -1}">${tab === 'live' ? 'Live' : 'Stats'}</button>`).join('')}</div></div>
    ${view === 'stats' ? (historyAgent ? itemHistoryView(historyAgent) : statsView()) : `<section id="live-panel" class="agent-grid" role="tabpanel" aria-labelledby="view-live" aria-label="Agents">${agents.map(card).join('') || '<div class="empty-state"><span>✓</span><h2>Nothing here right now.</h2><p>Choose All agents to see every provider.</p></div>'}</section>`}
    <footer><div title="Close the window to keep monitoring in the menu bar or system tray."><span class="footer-dot"></span>${snapshot.demo ? 'Demo' : settings.processEnabled ? `Resources ${age(snapshot.resourceAt)}` : 'Monitoring off'} <span class="separator">/</span> Usage ${age(snapshot.updatedAt)}</div><button id="quit" title="Stop monitoring and quit">Quit app</button></footer>
    </main>`;
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  const newHistoryTable = app.querySelector<HTMLElement>('.item-history-table');
  if (newHistoryTable && newHistoryTable.dataset.scrollKey === historyScrollKey) newHistoryTable.scrollTop = historyScroll;
  window.scrollTo({ top: scroll });
}
function applyTheme(): void {
  document.documentElement.dataset.theme = settings.theme;
}
async function openSettings(): Promise<void> {
  const info = await api.info();
  dialog.innerHTML = `<form id="settings-form"><div class="dialog-heading"><div><div class="eyebrow">MAKE IT YOURS</div><h2 id="settings-title">Panel settings</h2></div><button type="button" id="close-settings" class="icon-button" aria-label="Close settings">×</button></div>
    <p class="settings-intro">Private by design. No telemetry, account creation, or background uploads.</p>
    ${snapshot.demo ? '<div class="demo-banner">Demo settings are temporary and do not start monitoring.</div>' : ''}
    <fieldset><legend>Collection & privacy</legend>
    <label class="toggle-row"><span><strong>Local token history</strong><small>Read usage metadata from Claude, Codex, Grok, and Pi. No prompt or response text is retained.</small></span><input type="checkbox" name="localEnabled" ${settings.localEnabled ? 'checked' : ''}></label>
    <label class="toggle-row"><span><strong>CPU & memory monitoring</strong><small>Read the local process table every 5 seconds. Command lines are matched internally and never displayed or saved.</small></span><input type="checkbox" name="processEnabled" ${settings.processEnabled ? 'checked' : ''}></label>
    <label class="toggle-row"><span><strong>Provider quota checks</strong><small>Opt in to HTTPS requests to Anthropic, Grok, Kimi, and Fireworks using existing CLI credentials. Codex runs its own app-server and may renew its login. macOS may ask to unlock Claude's Keychain entry.</small></span><input type="checkbox" name="networkEnabled" ${settings.networkEnabled ? 'checked' : ''}></label>
    <p class="detail-note">The panel never signs you in, refreshes tokens itself, changes accounts, or sends prompts. Imported records are read separately; clear their directory below to disable imports.</p></fieldset>
    <fieldset><legend>Startup</legend><label class="toggle-row"><span><strong>Launch at login</strong><small>${info.startupSupported ? 'Start monitoring in the menu bar / system tray whenever you sign in after boot. Enabled by default.' : 'Available in the installed app. Demo, development, and test sessions never change OS startup settings.'}</small></span><input type="checkbox" name="startAtLogin" ${settings.startAtLogin ? 'checked' : ''} ${info.startupSupported ? '' : 'disabled'}></label></fieldset>
    <fieldset><legend>Appearance & alerts</legend><div class="form-grid"><label>Theme<select name="theme">${['system', 'dark', 'light'].map(theme => `<option value="${theme}" ${settings.theme === theme ? 'selected' : ''}>${theme[0].toUpperCase() + theme.slice(1)}</option>`).join('')}</select></label><label>Alert at (% used)<input name="threshold" type="number" min="50" max="100" value="${settings.threshold}" required></label><label>Quota check interval (seconds)<input name="refreshSeconds" type="number" min="30" max="3600" value="${settings.refreshSeconds}" required></label></div><p class="detail-note">History refreshes every 15 seconds. Manual quota checks have a 60-second minimum. OS notifications must be allowed for alerts.</p></fieldset>
    <fieldset><legend>CLI directories</legend><p class="detail-note">Absolute paths, not shell expressions. Environment overrides are picked up when the app is first configured. Launch from your terminal to inherit API-key environment variables.</p>
    ${providerIds.map(id => `<label>${names[id]} home<input name="path-${id}" value="${escape(settings.paths[id])}" spellcheck="false" autocomplete="off"></label>`).join('')}
    <label>Omarchy usage record directory<input name="importDir" value="${escape(settings.importDir)}" spellcheck="false" autocomplete="off"></label><label>Codex executable (optional; otherwise PATH)<input name="codexBinary" value="${escape(settings.codexBinary)}" spellcheck="false" autocomplete="off" placeholder="/absolute/path/to/codex"></label></fieldset>
    <p class="settings-location">v${escape(info.version)} · ${escape(info.platform)}<br>${escape(info.settingsPath)}</p><div id="settings-error" class="warning" role="alert"></div>
    <div class="dialog-actions"><button type="button" id="cancel-settings" class="secondary-button">Cancel</button><button type="submit" class="primary-button">Save settings</button></div></form>`;
  dialog.showModal();
  dialog.querySelector('#close-settings')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('#cancel-settings')?.addEventListener('click', () => dialog.close());
  dialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.target as HTMLFormElement);
    const input: Settings = { ...settings,
      localEnabled: data.has('localEnabled'), processEnabled: data.has('processEnabled'), networkEnabled: data.has('networkEnabled'),
      startAtLogin: info.startupSupported ? data.has('startAtLogin') : settings.startAtLogin,
      theme: data.get('theme') as Settings['theme'], threshold: Number(data.get('threshold')), refreshSeconds: Number(data.get('refreshSeconds')),
      paths: Object.fromEntries(providerIds.map(id => [id, String(data.get(`path-${id}`) || '').trim()])) as Settings['paths'],
      importDir: String(data.get('importDir') || '').trim(), codexBinary: String(data.get('codexBinary') || '').trim(),
    };
    const submit = dialog.querySelector<HTMLButtonElement>('[type=submit]')!; submit.disabled = true;
    try { settings = await api.saveSettings(input); applyTheme(); dialog.close(); render(); }
    catch { dialog.querySelector('#settings-error')!.textContent = 'Could not save settings. Check values and file permissions.'; }
    finally { submit.disabled = false; }
  });
}
app.addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button, a'); if (!target) return;
  if (target.classList.contains('brand')) { event.preventDefault(); filter = 'all'; view = 'live'; render(); }
  if (target.dataset.view) { view = target.dataset.view as typeof view; historyItem = null; render(); }
  if (target.dataset.historyItem && snapshot.agents.some(agent => agent.id === target.dataset.historyItem)) {
    historyItem = target.dataset.historyItem; historyRange = { from: '', to: '' }; historyGrouping = 'week'; historyDescending = true; collapsedGroups.clear();
    view = 'stats'; render(); window.scrollTo(0, 0); document.getElementById('item-history-title')?.focus();
  }
  if (target.id === 'history-back') { historyItem = null; render(); document.getElementById('view-stats')?.focus(); }
  if (target.id === 'history-clear') { historyRange = { from: '', to: '' }; render(); }
  if (target.id === 'history-sort') { historyDescending = !historyDescending; render(); }
  if (target.dataset.historyGroup) { const key = target.dataset.historyGroup; collapsedGroups.has(key) ? collapsedGroups.delete(key) : collapsedGroups.add(key); render(); }
  if (target.dataset.statsMode) { statsMode = target.dataset.statsMode as typeof statsMode; render(); }
  if (target.id === 'previous-week' || target.id === 'next-week') { range = shiftRange(range, target.id === 'previous-week' ? -7 : 7); render(); }
  if (target.id === 'current-week') { range = weekRange(); render(); }
  if (target.id === 'stats-today') { range = todayRange(); render(); }
  if (target.id === 'update-prices' && !priceRequest) {
    priceRequest = true; priceError = ''; render();
    try { await api.refreshPrices(); } catch { priceError = 'Could not start a price update. Wait a minute and retry.'; }
    finally { priceRequest = false; render(); }
  }
  if (target.dataset.filter) { filter = target.dataset.filter as typeof filter; render(); }
  if (target.id === 'settings') void openSettings();
  if (target.id === 'quit') void api.quit();
  if (target.id === 'refresh' && !refreshing) {
    refreshing = true; render();
    try { await api.refresh(); } finally { setTimeout(() => { refreshing = false; render(); }, 1000); }
  }
});
app.addEventListener('change', event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'stats-from') range = { ...range, from: target.value };
  else if (target.id === 'stats-to') range = { ...range, to: target.value };
  else if (target.id === 'stats-provider') statsProvider = target.value;
  else if (target.id === 'history-from') historyRange = { ...historyRange, from: target.value };
  else if (target.id === 'history-to') historyRange = { ...historyRange, to: target.value };
  else if (target.id === 'history-group' && ['day', 'week', 'month', 'year'].includes(target.value)) { historyGrouping = target.value as HistoryGrouping; collapsedGroups.clear(); }
  else return;
  render();
});
app.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(target.closest('[role=tablist]')!.querySelectorAll<HTMLButtonElement>('[role=tab]'));
  const index = tabs.indexOf(target as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[next].focus(); tabs[next].click();
});
const statsEditors = '#stats-from, #stats-to, #stats-provider, #history-from, #history-to, #history-group';
const editingStats = () => (document.activeElement as HTMLElement)?.matches(statsEditors);
app.addEventListener('focusout', event => {
  if (!(event.target as HTMLElement).matches(statsEditors)) return;
  setTimeout(() => { if (snapshot && !editingStats() && !dialog.open) render(); }, 0);
});
app.addEventListener('toggle', event => {
  const target = event.target as HTMLDetailsElement;
  if (target.dataset.details) target.open ? expanded.add(target.dataset.details) : expanded.delete(target.dataset.details);
}, true);
document.addEventListener('keydown', event => {
  if (dialog.open || (event.target as HTMLElement).matches('input, textarea, select')) return;
  if (event.key === 'Escape') void api.hide();
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey) document.querySelector<HTMLButtonElement>('#refresh')?.click();
  if (event.key === ',' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void openSettings(); }
});
async function start(): Promise<void> {
  if (!api) { app.textContent = 'Open this panel with the desktop app (npm start).'; return; }
  try {
    [snapshot, settings] = await Promise.all([api.snapshot(), api.settings()]);
    applyTheme(); render();
    api.onSnapshot(value => { snapshot = value; if (!editingStats()) render(); });
    setInterval(() => { if (!dialog.open && !editingStats()) render(); }, 30000);
    let fitTimer: ReturnType<typeof setTimeout>;
    new ResizeObserver(() => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => { void api.fitContent(Math.min(20000, Math.ceil(app.getBoundingClientRect().height))).catch(() => {}); }, 30);
    }).observe(app);
  } catch { app.textContent = 'The panel could not connect to its desktop host. Restart the app.'; }
}
void start();
