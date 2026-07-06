import type { PayerAdapter } from "./adapter.js";
import { deltaAdapter } from "./adapters/delta.js";
import { metlifeAdapter } from "./adapters/metlife.js";

export type { PayerAdapter } from "./adapter.js";
export { PORTAL_CREDENTIALS, resetSessions, MockPortalAdapter } from "./adapter.js";
export { launchBrowser, closeBrowser, resolveChromiumExecutable } from "./browser.js";
export { runCanary } from "./canary.js";

const ADAPTERS: Record<string, PayerAdapter> = {
  [deltaAdapter.payerKey]: deltaAdapter,
  [metlifeAdapter.payerKey]: metlifeAdapter,
};

export function getAdapter(payerKey: string): PayerAdapter | null {
  return ADAPTERS[payerKey] ?? null;
}

export function listAdapters(): PayerAdapter[] {
  return Object.values(ADAPTERS);
}
