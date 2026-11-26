import { buildImageFilename } from '../shared/filename';
import { RuntimeMessage } from '../shared/messages';
import {
  addToBasket,
  clearBasket,
  getBasket,
  getSettings,
  removeFromBasket,
} from '../shared/storage';
import { BasketImageItem } from '../shared/types';
import { getUpgradedImageCandidates } from '../shared/url-upgrader';

// --- Badge Counter Sync ---
async function syncBasketBadge(count?: number): Promise<void> {
  try {
    const total = typeof count === 'number' ? count : (await getBasket()).length;
    await chrome.action.setBadgeText({ text: total > 0 ? String(total > 999 ? '999+' : total) : '' });
    if (total > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#0EA5E9' });
    }
  } catch {
    // ignore badge errors
  }
}

// --- Context Menus ---
async function setupContextMenus(): Promise<void> {
  try {
    await chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
      id: 'lumina-parent',
      title: 'Lumina — Coletor & Exportador em Massa',
      contexts: ['image', 'page', 'link', 'video'],
    });

    chrome.contextMenus.create({
      id: 'lumina-add-basket',
      parentId: 'lumina-parent',
      title: '➕ Adicionar foto à Cesta (Exportação em Massa)',
      contexts: ['image'],
    });

    chrome.contextMenus.create({
      id: 'lumina-save-now',
      parentId: 'lumina-parent',
      title: '⬇ Baixar foto original agora (Máx. resolução)',
      contexts: ['image'],
    });

    chrome.contextMenus.create({
      id: 'lumina-sep',
      parentId: 'lumina-parent',
      type: 'separator',
      contexts: ['image', 'page', 'link', 'video'],
    });

    chrome.contextMenus.create({
      id: 'lumina-picker',
      parentId: 'lumina-parent',
      title: '🎯 Ativar Coletor Multi-Clique nesta página',
      contexts: ['page', 'image', 'link', 'video'],
    });

    chrome.contextMenus.create({
      id: 'lumina-open-panel',
      parentId: 'lumina-parent',
      title: '📦 Abrir Painel & Exportar Cesta (ZIP)',
      contexts: ['page', 'image', 'link', 'video'],
    });
  } catch (err) {
    console.error('[Lumina] Context menu setup error:', err);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setupContextMenus();
  await syncBasketBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupContextMenus();
  await syncBasketBadge();
});

// --- Toast Feedback Helper (MV3 Rule #9) ---
async function sendToastToTab(
  tabId: number | undefined,
  msg: Extract<RuntimeMessage, { type: 'CONTENT_TOAST' }>
): Promise<void> {
  if (typeof tabId !== 'number') return;
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Tab may not accept content scripts
  }
}

// --- Robust Image Fetcher (CDN Full-Res Upgrader + Credentials + Hotlink Page-Context Bypass) ---
async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  return `data:${mime};base64,${btoa(binary)}`;
}

async function tryDirectFetchImage(url: string): Promise<{ dataUrl: string; mimeType: string } | null> {
  for (const credentials of ['include', 'omit'] as const) {
    try {
      const response = await fetch(url, { credentials, mode: 'cors' });
      if (!response.ok) continue;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        continue;
      }
      const blob = await response.blob();
      if (blob.size < 128) continue;
      const dataUrl = await blobToDataUrl(blob);
      const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      return { dataUrl, mimeType };
    } catch {
      // try next credential mode
    }
  }
  return null;
}

async function fetchImageAsDataUrl(
  url: string,
  tabId?: number,
  upgradeThumbnails = true
): Promise<{ dataUrl: string; resolvedUrl: string; mimeType: string }> {
  if (url.startsWith('data:image/')) {
    const mimeMatch = url.match(/^data:([^;]+)/);
    return { dataUrl: url, resolvedUrl: url, mimeType: mimeMatch ? mimeMatch[1] : 'image/png' };
  }

  const candidates = upgradeThumbnails ? getUpgradedImageCandidates(url) : [url];

  for (const candidate of candidates) {
    const fetched = await tryDirectFetchImage(candidate);
    if (fetched) {
      return { dataUrl: fetched.dataUrl, resolvedUrl: candidate, mimeType: fetched.mimeType };
    }
  }

  // Hotlink-Protection Fallback: fetch inside page context (preserves Referer + cookies!)
  let targetTabId = tabId;
  if (typeof targetTabId !== 'number') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTabId = activeTab?.id;
  }

  if (typeof targetTabId === 'number') {
    try {
      const resp = (await chrome.tabs.sendMessage(targetTabId, {
        type: 'CONTENT_FETCH_IMAGE',
        url,
      } satisfies RuntimeMessage)) as { ok: boolean; dataUrl?: string } | undefined;
      if (resp?.ok && resp.dataUrl) {
        const mimeMatch = resp.dataUrl.match(/^data:([^;]+)/);
        return {
          dataUrl: resp.dataUrl,
          resolvedUrl: url,
          mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
        };
      }
    } catch {
      // ignore if content script unavailable
    }
  }

  throw new Error('Não foi possível acessar a imagem (servidor bloqueou download).');
}

async function saveSingleImageNow(params: {
  src: string;
  inlineDataUrl?: string;
  alt?: string;
  siteHost?: string;
  tabId?: number;
}): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const settings = await getSettings();
  const toastId = `save-${Date.now()}`;

  try {
    let dataUrl = params.inlineDataUrl;
    let resolvedUrl = params.src;
    let mimeType = 'image/png';

    if (dataUrl) {
      const m = dataUrl.match(/^data:([^;]+)/);
      if (m) mimeType = m[1];
    } else {
      const fetched = await fetchImageAsDataUrl(params.src, params.tabId, settings.upgradeThumbnailUrls);
      dataUrl = fetched.dataUrl;
      resolvedUrl = fetched.resolvedUrl;
      mimeType = fetched.mimeType;
    }

    const filename = buildImageFilename({
      srcUrl: resolvedUrl,
      alt: params.alt,
      siteHost: params.siteHost,
      mimeType,
    });

    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });

    await sendToastToTab(params.tabId, {
      type: 'CONTENT_TOAST',
      toastId,
      status: 'success',
      title: 'Foto original salva!',
      subtitle: filename,
    });

    return { ok: true, filename };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Erro ao salvar imagem.';
    await sendToastToTab(params.tabId, {
      type: 'CONTENT_TOAST',
      toastId,
      status: 'error',
      title: 'Erro ao baixar foto',
      subtitle: error,
    });
    return { ok: false, error };
  }
}

async function ensureContentScriptAndTogglePicker(tabId: number, active?: boolean): Promise<void> {
  const msg: RuntimeMessage = { type: 'TOGGLE_PICKER', active };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
    await chrome.tabs.sendMessage(tabId, msg);
  }
}

// --- Context Menu Clicks ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  const windowId = tab?.windowId;

  if (info.menuItemId === 'lumina-open-panel' && typeof windowId === 'number') {
    await chrome.sidePanel.open({ windowId });
    return;
  }

  if (info.menuItemId === 'lumina-picker' && typeof tabId === 'number') {
    await ensureContentScriptAndTogglePicker(tabId, true);
    return;
  }

  const srcUrl = info.srcUrl;
  if (!srcUrl) return;

  let siteHost = '';
  try {
    if (tab?.url) siteHost = new URL(tab.url).hostname;
  } catch {
    // ignore
  }

  if (info.menuItemId === 'lumina-add-basket') {
    const item: BasketImageItem = {
      id: `ctx-${srcUrl.slice(0, 80)}`,
      src: srcUrl,
      bestSrc: srcUrl,
      alt: '',
      sourceType: 'img',
      naturalWidth: 0,
      naturalHeight: 0,
      renderedWidth: 0,
      renderedHeight: 0,
      pageUrl: tab?.url || '',
      pageTitle: tab?.title || '',
      siteHost,
      tabId,
      addedAt: Date.now(),
    };
    const { basket, addedCount } = await addToBasket([item]);
    await syncBasketBadge(basket.length);
    chrome.runtime.sendMessage({ type: 'BASKET_UPDATED', count: basket.length } satisfies RuntimeMessage).catch(() => {});

    await sendToastToTab(tabId, {
      type: 'CONTENT_TOAST',
      toastId: `basket-${Date.now()}`,
      status: 'success',
      title: addedCount > 0 ? `Adicionada à Cesta (${basket.length})` : `Já está na Cesta (${basket.length})`,
      subtitle: 'Abra o painel Lumina para exportar tudo em 1 clique (.ZIP).',
    });
    return;
  }

  if (info.menuItemId === 'lumina-save-now') {
    await saveSingleImageNow({
      src: srcUrl,
      siteHost,
      tabId,
    });
  }
});

// --- Keyboard Shortcuts ---
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === 'toggle-photo-picker') {
    await ensureContentScriptAndTogglePicker(tab.id);
  } else if (command === 'open-exporter-panel' && typeof tab.windowId === 'number') {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// --- Message Router ---
chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === 'BASKET_ADD') {
    (async () => {
      const enriched = message.items.map((item) => ({
        ...item,
        tabId: item.tabId ?? sender.tab?.id,
      }));
      const { basket, addedCount } = await addToBasket(enriched);
      await syncBasketBadge(basket.length);
      chrome.runtime.sendMessage({ type: 'BASKET_UPDATED', count: basket.length } satisfies RuntimeMessage).catch(() => {});

      if (!message.silent && sender.tab?.id) {
        await sendToastToTab(sender.tab.id, {
          type: 'CONTENT_TOAST',
          toastId: `add-${Date.now()}`,
          status: 'success',
          title:
            addedCount > 0
              ? `+${addedCount} na Cesta (Total: ${basket.length})`
              : `Foto já está na Cesta (${basket.length})`,
          subtitle: 'Clique no ícone Lumina para exportar todas em ZIP.',
        });
      }
      sendResponse({ ok: true, count: basket.length, addedCount });
    })();
    return true;
  }

  if (message.type === 'BASKET_REMOVE') {
    (async () => {
      const basket = await removeFromBasket(message.bestSrcs);
      await syncBasketBadge(basket.length);
      chrome.runtime.sendMessage({ type: 'BASKET_UPDATED', count: basket.length } satisfies RuntimeMessage).catch(() => {});
      sendResponse({ ok: true, count: basket.length });
    })();
    return true;
  }

  if (message.type === 'BASKET_CLEAR') {
    (async () => {
      await clearBasket();
      await syncBasketBadge(0);
      chrome.runtime.sendMessage({ type: 'BASKET_UPDATED', count: 0 } satisfies RuntimeMessage).catch(() => {});
      sendResponse({ ok: true, count: 0 });
    })();
    return true;
  }

  if (message.type === 'SAVE_SINGLE_NOW') {
    (async () => {
      const res = await saveSingleImageNow({
        src: message.src,
        inlineDataUrl: message.inlineDataUrl,
        alt: message.alt,
        siteHost: message.siteHost,
        tabId: message.tabId ?? sender.tab?.id,
      });
      sendResponse(res);
    })();
    return true;
  }

  if (message.type === 'FETCH_IMAGE_DATA_URL') {
    (async () => {
      try {
        const settings = await getSettings();
        const { dataUrl, resolvedUrl, mimeType } = await fetchImageAsDataUrl(
          message.url,
          message.tabId,
          settings.upgradeThumbnailUrls
        );
        sendResponse({ ok: true, dataUrl, resolvedUrl, mimeType });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Erro ao buscar imagem.',
        });
      }
    })();
    return true;
  }

  if (message.type === 'DOWNLOAD_URL') {
    (async () => {
      try {
        const downloadId = await chrome.downloads.download({
          url: message.url,
          filename: message.filename,
          saveAs: message.saveAs ?? false,
          conflictAction: 'uniquify',
        });
        sendResponse({ ok: true, downloadId });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Erro ao baixar arquivo.',
        });
      }
    })();
    return true;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    (async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (typeof t.id === 'number') {
          chrome.tabs.sendMessage(t.id, message).catch(() => {});
        }
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  return false;
});
