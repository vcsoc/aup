import { parentPort, workerData } from 'node:worker_threads';
import { names, newAgent, emptyResources, providerIds, type Settings, type Snapshot } from '../shared/types.js';
import { UsageScanner } from './usage.js';
import { QuotaCollector } from './quotas.js';
import { importRecords } from './imports.js';
import { collectProcesses } from './processes.js';
import { probePids } from './rpc.js';

let settings: Settings = workerData.settings;
let scanner = new UsageScanner(); const quotas = new QuotaCollector();
let generation = 0; let scanning = false; let sampling = false; let tick = 0;
let snapshot: Snapshot = { agents: providerIds.map(id => newAgent(id, names[id])), updatedAt: 0, resourceAt: 0, scanning: true, demo: false, errors: [], platform: process.platform };
let processError = ''; let scanErrors: string[] = [];
const publish = () => parentPort?.postMessage({ ...snapshot, errors: [...scanErrors, ...(processError ? [processError] : [])] });
async function scan(force = false): Promise<void> {
  if (scanning) return;
  scanning = true; snapshot.scanning = true; publish();
  const version = generation; const currentSettings = settings;
  try {
    const local = await scanner.scan(currentSettings);
    const imported = await importRecords(currentSettings.importDir);
    const imports = new Map(imported.agents.map(agent => [agent.id, agent]));
    const agents = await Promise.all(providerIds.map(async id => {
      if (imports.has(id)) return imports.get(id)!;
      const agent = newAgent(id, names[id]);
      const quota = await quotas.collect(id, currentSettings, force);
      Object.assign(agent, { limits: quota.limits, balance: quota.balance, plan: quota.plan, quotaStatus: quota.status, quotaAt: quota.at, stale: quota.stale });
      agent.usage = local.usage[id] || agent.usage;
      agent.warnings = local.warnings[id] || [];
      agent.source = currentSettings.localEnabled ? 'Local CLI history' : 'Local history off';
      return agent;
    }));
    for (const agent of imported.agents) if (!providerIds.includes(agent.id as typeof providerIds[number])) agents.push(agent);
    if (version !== generation) return;
    // Process samples may have arrived while quota I/O was in flight.
    for (const agent of agents) agent.resources = snapshot.agents.find(existing => existing.id === agent.id)?.resources || emptyResources();
    scanErrors = imported.warnings;
    snapshot = { ...snapshot, agents, updatedAt: Date.now() };
  } catch { if (version === generation) scanErrors = ['Usage scan failed. Last successful numbers are retained; refresh to retry.']; }
  finally {
    scanning = false; snapshot.scanning = false; publish();
    if (version !== generation) void scan();
  }
}
async function sample(): Promise<void> {
  if (sampling) return;
  sampling = true; const version = generation;
  try {
    const resources = settings.processEnabled ? await collectProcesses(new Set([process.pid, ...probePids])) : {};
    if (version !== generation) return;
    for (const agent of snapshot.agents) agent.resources = resources[agent.id as typeof providerIds[number]] || emptyResources();
    processError = ''; snapshot.resourceAt = settings.processEnabled ? Date.now() : 0;
  } catch {
    if (version !== generation) return;
    processError = 'Process metrics are unavailable (OS permissions or process service).';
    snapshot.resourceAt = 0;
    for (const agent of snapshot.agents) agent.resources = emptyResources();
  } finally { sampling = false; publish(); }
}
parentPort?.on('message', (message: { type: string; settings?: Settings }) => {
  if (message.type === 'settings' && message.settings) {
    generation++; settings = message.settings; scanner = new UsageScanner(); quotas.clear();
    // Clear old numbers immediately when changing roots or disabling access.
    snapshot.agents = providerIds.map(id => newAgent(id, names[id]));
    snapshot.updatedAt = 0; snapshot.resourceAt = 0;
    void scan(); void sample();
  } else if (message.type === 'refresh') { void scan(true); void sample(); }
});
void scan(); void sample();
setInterval(() => { void sample(); if (++tick % 3 === 0) void scan(); }, 5000);
