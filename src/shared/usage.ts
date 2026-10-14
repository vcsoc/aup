import type { Usage } from './types.js';

export interface TokenTotals { processed: number; cached?: number; uncached?: number }

/** Keep cache-inclusive history intact; never invent a breakdown for imports. */
export function tokenTotals(usages: Usage[]): TokenTotals {
  const processed = usages.reduce((sum, usage) => sum + usage.todayTokens, 0);
  if (usages.some(usage => usage.todayTokens > 0 && (usage.todayCachedTokens === undefined || !Number.isFinite(usage.todayCachedTokens)))) return { processed };
  const cached = usages.reduce((sum, usage) => sum + Math.min(usage.todayTokens, Math.max(0, usage.todayCachedTokens || 0)), 0);
  return { processed, cached, uncached: processed - cached };
}
