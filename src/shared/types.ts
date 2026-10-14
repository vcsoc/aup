export const providerIds = ['claude', 'codex', 'grok', 'kimi', 'fireworks', 'pi'] as const;
export type ProviderId = typeof providerIds[number];
export const names: Record<ProviderId, string> = {
  claude: 'Claude Code', codex: 'Codex', grok: 'Grok', kimi: 'Kimi Code', fireworks: 'Fireworks', pi: 'Pi',
};
export interface Limit { label: string; percent: number; resetsAt: string }
export interface Balance { remaining: number; currency: string; estimated: boolean }
export interface DayUsage { date: string; tokens: number }
export interface CostSummary { usd: number; knownTokens: number; unpricedTokens: number; estimated: boolean; recorded: boolean }
export interface HistoryDay extends DayUsage { cachedTokens?: number; cost: CostSummary }
export interface PricingInfo { fetchedAt: number; models: number; updating?: boolean; error?: string }
export interface Usage {
  todayTokens: number; totalTokens: number; prompts: number; sessions: number;
  days: DayUsage[]; models: Record<string, number>;
  // todayTokens/days/models include cache reads. Undefined means the source
  // cannot provide a trustworthy cache breakdown (e.g. imported aggregates).
  todayCachedTokens?: number; sources?: Record<string, number>;
  todayCost?: CostSummary; totalCost?: CostSummary; history?: HistoryDay[];
  lastUsedAt?: number; // Latest observed local request/prompt timestamp, not file mtime.
}
export interface Resources { cpu: number; memory: number; processes: number }
export interface Agent {
  id: string; name: string; plan: string; limits: Limit[]; balance?: Balance;
  quotaStatus: string; quotaAt: number; stale: boolean; usage: Usage;
  resources: Resources; source: string; warnings: string[]; usageNote?: string;
}
export interface Settings {
  networkEnabled: boolean; processEnabled: boolean; localEnabled: boolean; startAtLogin: boolean;
  refreshSeconds: number; threshold: number; theme: 'system' | 'dark' | 'light';
  paths: Record<ProviderId, string>; importDir: string; codexBinary: string;
}
export interface Snapshot {
  agents: Agent[]; updatedAt: number; resourceAt: number; scanning: boolean;
  demo: boolean; errors: string[]; platform: string; pricing?: PricingInfo;
}
export interface AppInfo { version: string; settingsPath: string; platform: string; startupSupported: boolean }
export interface PanelAPI {
  snapshot(): Promise<Snapshot>;
  settings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  refresh(): Promise<void>;
  refreshPrices(): Promise<void>;
  fitContent(height: number): Promise<void>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
  info(): Promise<AppInfo>;
  hide(): Promise<void>;
  quit(): Promise<void>;
}
export const emptyUsage = (): Usage => ({ todayTokens: 0, totalTokens: 0, prompts: 0, sessions: 0, days: [], models: {} });
export const emptyResources = (): Resources => ({ cpu: 0, memory: 0, processes: 0 });
export const newAgent = (id: string, name: string): Agent => ({
  id, name, plan: '', limits: [], quotaStatus: 'Network quotas off', quotaAt: 0,
  stale: false, usage: emptyUsage(), resources: emptyResources(), source: 'local', warnings: [],
});
