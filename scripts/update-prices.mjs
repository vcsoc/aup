import { fetchPricing, savePricing } from '../dist/main/pricing.js';
import { fileURLToPath } from 'node:url';
const catalog = await fetchPricing();
await savePricing(fileURLToPath(new URL('../assets/model-prices.json', import.meta.url)), catalog);
console.log(`Bundled ${Object.keys(catalog.models).length} model prices from models.dev (${new Date(catalog.fetchedAt).toISOString()}).`);
