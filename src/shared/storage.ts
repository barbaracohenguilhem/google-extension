import {
  BasketImageItem,
  DEFAULT_SETTINGS,
  ExportHistoryEntry,
  ExtensionSettings,
} from './types';

const SETTINGS_KEY = 'lumina_bulk_settings_v2';
const BASKET_KEY = 'lumina_bulk_basket_v2';
const HISTORY_KEY = 'lumina_bulk_history_v2';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    disabledHoverDomains: Array.isArray(stored?.disabledHoverDomains)
      ? stored.disabledHoverDomains
      : [],
  };
}

export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function toggleDomainHoverMute(hostname: string): Promise<{
  muted: boolean;
  settings: ExtensionSettings;
}> {
  const cleanHost = hostname.toLowerCase().trim();
  const current = await getSettings();
  const set = new Set(current.disabledHoverDomains);
  let muted: boolean;
  if (set.has(cleanHost)) {
    set.delete(cleanHost);
    muted = false;
  } else {
    set.add(cleanHost);
    muted = true;
  }
  const settings = await saveSettings({ disabledHoverDomains: Array.from(set) });
  return { muted, settings };
}

// --- Persistent Multi-Site Bulk Basket ---
export async function getBasket(): Promise<BasketImageItem[]> {
  const result = await chrome.storage.local.get(BASKET_KEY);
  return (result[BASKET_KEY] as BasketImageItem[] | undefined) ?? [];
}

export async function addToBasket(items: BasketImageItem[]): Promise<{
  basket: BasketImageItem[];
  addedCount: number;
}> {
  const existing = await getBasket();
  const seen = new Set(existing.map((i) => i.bestSrc));
  const newlyAdded: BasketImageItem[] = [];

  for (const item of items) {
    if (!item.bestSrc || seen.has(item.bestSrc)) continue;
    seen.add(item.bestSrc);
    newlyAdded.push(item);
  }

  const basket = [...newlyAdded, ...existing];
  await chrome.storage.local.set({ [BASKET_KEY]: basket });
  return { basket, addedCount: newlyAdded.length };
}

export async function removeFromBasket(bestSrcs: string[]): Promise<BasketImageItem[]> {
  const toRemove = new Set(bestSrcs);
  const existing = await getBasket();
  const basket = existing.filter((i) => !toRemove.has(i.bestSrc));
  await chrome.storage.local.set({ [BASKET_KEY]: basket });
  return basket;
}

export async function clearBasket(): Promise<void> {
  await chrome.storage.local.set({ [BASKET_KEY]: [] });
}

// --- Export History ---
export async function addExportHistory(entry: ExportHistoryEntry): Promise<void> {
  const existing = await getExportHistory();
  const next = [entry, ...existing].slice(0, 25);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

export async function getExportHistory(): Promise<ExportHistoryEntry[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return (result[HISTORY_KEY] as ExportHistoryEntry[] | undefined) ?? [];
}

export async function clearExportHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
