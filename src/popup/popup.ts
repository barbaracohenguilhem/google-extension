import { formatBytes } from '../shared/filename';
import { RuntimeMessage } from '../shared/messages';
import {
  getBasket,
  getSettings,
  saveSettings,
  toggleDomainHoverMute,
} from '../shared/storage';
import {
  BasketImageItem,
  ExportMode,
  ExtensionSettings,
  PageImageItem,
} from '../shared/types';
import { runBulkExport } from '../shared/zip-exporter';

let settings: ExtensionSettings;
let basket: BasketImageItem[] = [];
let pageImages: PageImageItem[] = [];
let activeTab: chrome.tabs.Tab | null = null;
let activeHostname: string | null = null;
let isExporting = false;

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ensureContentScriptAndSend<T>(tabId: number, message: RuntimeMessage): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch {
      return null;
    }
  }
}

function updateBasketUI(): void {
  const countEl = document.getElementById('basketCount')!;
  const exportBtn = document.getElementById('exportBasketBtn') as HTMLButtonElement;
  const clearBtn = document.getElementById('clearBasketBtn') as HTMLButtonElement;

  countEl.textContent = String(basket.length);
  exportBtn.disabled = basket.length === 0 || isExporting;
  clearBtn.disabled = basket.length === 0 || isExporting;

  const modeLabel = settings.exportMode === 'zip' ? '.ZIP' : 'Pasta';
  exportBtn.textContent =
    basket.length > 0
      ? `📦 Exportar Cesta (${basket.length} → ${modeLabel})`
      : `📦 Exportar Cesta (${modeLabel})`;
}

function updateSiteMuteUI(): void {
  const row = document.getElementById('siteMuteRow');
  const domainEl = document.getElementById('siteDomainLabel');
  const btn = document.getElementById('siteMuteBtn');
  if (!row || !domainEl || !btn || !activeHostname) return;

  row.classList.remove('hidden');
  domainEl.textContent = activeHostname;
  const isMuted = settings.disabledHoverDomains.includes(activeHostname);
  btn.classList.toggle('muted', isMuted);
  btn.textContent = isMuted ? '🔊 Reativar neste site' : '🔇 Pausar neste site';
}

async function persistSettings(partial: Partial<ExtensionSettings>): Promise<void> {
  settings = await saveSettings(partial);
  updateBasketUI();
  chrome.runtime
    .sendMessage({ type: 'SETTINGS_UPDATED', settings } satisfies RuntimeMessage)
    .catch(() => {});
}

function toBasketItem(img: PageImageItem): BasketImageItem {
  return {
    ...img,
    pageUrl: activeTab?.url || '',
    pageTitle: activeTab?.title || '',
    siteHost: activeHostname || 'web',
    tabId: activeTab?.id,
    addedAt: Date.now(),
  };
}

function renderPageGrid(): void {
  const statusEl = document.getElementById('galleryStatus')!;
  const gridEl = document.getElementById('imageGrid')!;
  const countEl = document.getElementById('imageCount')!;
  const addAllHint = document.getElementById('addAllHint')!;

  gridEl.innerHTML = '';
  countEl.textContent = String(pageImages.length);
  addAllHint.textContent = pageImages.length > 0 ? `${pageImages.length} fotos desta aba` : 'Nenhuma detectada';

  if (pageImages.length === 0) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Nenhuma foto grande detectada. Use "Coletor Multi-Clique" ou "Auto-Scroll" no Painel.';
    return;
  }

  statusEl.classList.add('hidden');
  const basketSet = new Set(basket.map((i) => i.bestSrc));
  const frag = document.createDocumentFragment();

  for (const item of pageImages.slice(0, 30)) {
    const inBasket = basketSet.has(item.bestSrc);
    const card = document.createElement('div');
    card.className = `img-card ${inBasket ? 'in-basket' : ''}`;

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.inlineDataUrl || item.src;
    img.alt = item.alt || 'Foto';

    const badge = document.createElement('span');
    badge.className = 'img-dim-badge';
    badge.textContent = `${item.naturalWidth}×${item.naturalHeight}`;

    const actions = document.createElement('div');
    actions.className = 'img-card-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = `card-add-btn ${inBasket ? 'added' : ''}`;
    addBtn.textContent = inBasket ? '✓ Cesta' : '➕ Cesta';
    addBtn.addEventListener('click', async () => {
      if (basketSet.has(item.bestSrc)) {
        await chrome.runtime.sendMessage({
          type: 'BASKET_REMOVE',
          bestSrcs: [item.bestSrc],
        } satisfies RuntimeMessage);
      } else {
        await chrome.runtime.sendMessage({
          type: 'BASKET_ADD',
          items: [toBasketItem(item)],
          silent: true,
        } satisfies RuntimeMessage);
      }
      basket = await getBasket();
      updateBasketUI();
      renderPageGrid();
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'card-dl-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Baixar original agora';
    dlBtn.addEventListener('click', async () => {
      dlBtn.textContent = '...';
      await chrome.runtime.sendMessage({
        type: 'SAVE_SINGLE_NOW',
        src: item.bestSrc,
        inlineDataUrl: item.inlineDataUrl,
        alt: item.alt,
        siteHost: activeHostname || undefined,
        tabId: activeTab?.id,
      } satisfies RuntimeMessage);
      dlBtn.textContent = '✓';
    });

    actions.appendChild(addBtn);
    actions.appendChild(dlBtn);
    card.appendChild(img);
    card.appendChild(badge);
    card.appendChild(actions);
    frag.appendChild(card);
  }

  gridEl.appendChild(frag);
}

async function scanActiveTab(): Promise<void> {
  const statusEl = document.getElementById('galleryStatus')!;
  const gridEl = document.getElementById('imageGrid')!;
  gridEl.innerHTML = '';
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Escaneando fotos da aba ativa...';

  activeTab = await getActiveTab();
  if (!activeTab?.id || !activeTab.url || /^(chrome|edge|about|chrome-extension):/.test(activeTab.url)) {
    pageImages = [];
    document.getElementById('imageCount')!.textContent = '0';
    statusEl.textContent = 'Abra qualquer site na web para coletar fotos em massa.';
    return;
  }

  try {
    activeHostname = new URL(activeTab.url).hostname.toLowerCase();
    updateSiteMuteUI();
  } catch {
    activeHostname = null;
  }

  const res = await ensureContentScriptAndSend<{ ok: boolean; images: PageImageItem[] }>(activeTab.id, {
    type: 'SCAN_PAGE_IMAGES',
    minSize: 100,
  });

  if (!res || !res.ok) {
    pageImages = [];
    document.getElementById('imageCount')!.textContent = '0';
    statusEl.textContent = 'Não foi possível ler esta página. Tente atualizar a aba.';
    return;
  }

  pageImages = res.images;
  renderPageGrid();
}

async function exportBasketFromPopup(): Promise<void> {
  if (basket.length === 0 || isExporting) return;
  isExporting = true;
  updateBasketUI();

  const progWrap = document.getElementById('popupExportProgress')!;
  const progText = document.getElementById('popupProgressText')!;
  const progFill = document.getElementById('popupProgressFill') as HTMLDivElement;
  progWrap.classList.remove('hidden');

  try {
    const label = activeHostname || 'multi-sites';
    const result = await runBulkExport({
      items: basket,
      mode: settings.exportMode,
      label,
      includeManifestInZip: settings.includeManifestInZip,
      onProgress: (p) => {
        const pct = p.stage === 'packing' ? 92 : p.stage === 'done' ? 100 : Math.round((p.completed / Math.max(1, p.total)) * 88);
        progFill.style.width = `${Math.max(5, pct)}%`;
        progText.textContent = p.message;
      },
    });
    progText.textContent = `✅ ${result.succeeded} foto(s) exportadas (${formatBytes(result.totalBytes)}) em ${(result.elapsedMs / 1000).toFixed(1)}s!`;
  } catch (err) {
    progText.textContent = `❌ ${err instanceof Error ? err.message : 'Falha na exportação.'}`;
  } finally {
    isExporting = false;
    updateBasketUI();
  }
}

async function initPopup(): Promise<void> {
  [settings, basket] = await Promise.all([getSettings(), getBasket()]);

  const hoverToggle = document.getElementById('hoverToggle') as HTMLInputElement;
  const exportModeSelect = document.getElementById('exportModeSelect') as HTMLSelectElement;
  const upgradeCdnToggle = document.getElementById('upgradeCdnToggle') as HTMLInputElement;

  hoverToggle.checked = settings.showHoverButton;
  exportModeSelect.value = settings.exportMode;
  upgradeCdnToggle.checked = settings.upgradeThumbnailUrls;
  updateBasketUI();

  hoverToggle.addEventListener('change', () => void persistSettings({ showHoverButton: hoverToggle.checked }));
  exportModeSelect.addEventListener('change', () =>
    void persistSettings({ exportMode: exportModeSelect.value as ExportMode })
  );
  upgradeCdnToggle.addEventListener('change', () =>
    void persistSettings({ upgradeThumbnailUrls: upgradeCdnToggle.checked })
  );

  document.getElementById('siteMuteBtn')?.addEventListener('click', async () => {
    if (!activeHostname) return;
    const { settings: next } = await toggleDomainHoverMute(activeHostname);
    settings = next;
    updateSiteMuteUI();
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings } satisfies RuntimeMessage).catch(() => {});
  });

  const openPanel = async () => {
    const tab = await getActiveTab();
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  };
  document.getElementById('openPanelBtn')?.addEventListener('click', openPanel);
  document.getElementById('openPanelFooterBtn')?.addEventListener('click', openPanel);

  document.getElementById('pickerBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
      await openPanel();
      return;
    }
    await ensureContentScriptAndSend(tab.id, { type: 'TOGGLE_PICKER', active: true });
    window.close();
  });

  document.getElementById('addAllPageBtn')?.addEventListener('click', async () => {
    if (pageImages.length === 0) return;
    await chrome.runtime.sendMessage({
      type: 'BASKET_ADD',
      items: pageImages.map(toBasketItem),
      silent: true,
    } satisfies RuntimeMessage);
    basket = await getBasket();
    updateBasketUI();
    renderPageGrid();
  });

  document.getElementById('clearBasketBtn')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'BASKET_CLEAR' } satisfies RuntimeMessage);
    basket = [];
    updateBasketUI();
    renderPageGrid();
  });

  document.getElementById('exportBasketBtn')?.addEventListener('click', () => void exportBasketFromPopup());
  document.getElementById('rescanBtn')?.addEventListener('click', () => void scanActiveTab());

  await scanActiveTab();
}

void initPopup();
