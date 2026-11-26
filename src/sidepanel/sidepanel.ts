import { formatBytes } from '../shared/filename';
import { RuntimeMessage } from '../shared/messages';
import {
  clearExportHistory,
  getBasket,
  getExportHistory,
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
let rawPageImages: PageImageItem[] = [];
let filteredPageImages: PageImageItem[] = [];
const selectedPageUrls = new Set<string>();

let activeTab: chrome.tabs.Tab | null = null;
let activeHostname = 'web';
let autoScrolling = false;
let exportAbort: AbortController | null = null;
let isExporting = false;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function switchTab(tab: 'page' | 'basket' | 'settings'): void {
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });
  if (tab === 'basket') void refreshBasket();
  if (tab === 'settings') void renderHistory();
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function sendToActiveTab<T>(message: RuntimeMessage): Promise<{ tab: chrome.tabs.Tab; res: T } | null> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
    return null;
  }
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, message)) as T;
    return { tab, res };
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      const res = (await chrome.tabs.sendMessage(tab.id, message)) as T;
      return { tab, res };
    } catch {
      return null;
    }
  }
}

function toBasketItem(item: PageImageItem): BasketImageItem {
  return {
    ...item,
    pageUrl: activeTab?.url || '',
    pageTitle: activeTab?.title || '',
    siteHost: activeHostname,
    tabId: activeTab?.id,
    addedAt: Date.now(),
  };
}

// --- Filtering & Rendering Page Grid ---
function applyPageFilters(): void {
  const minSize = Number(el<HTMLSelectElement>('filterMinSize').value) || 48;
  const orientation = el<HTMLSelectElement>('filterOrientation').value;
  const source = el<HTMLSelectElement>('filterSource').value;

  filteredPageImages = rawPageImages.filter((item) => {
    const maxDim = Math.max(item.naturalWidth, item.naturalHeight);
    if (maxDim < minSize) return false;

    if (orientation !== 'all') {
      const ratio = item.naturalWidth / Math.max(1, item.naturalHeight);
      if (orientation === 'landscape' && ratio <= 1.1) return false;
      if (orientation === 'portrait' && ratio >= 0.91) return false;
      if (orientation === 'square' && (ratio < 0.91 || ratio > 1.1)) return false;
    }

    if (source !== 'all') {
      if (source === 'img' && item.sourceType !== 'img' && item.sourceType !== 'picture') return false;
      if (source === 'background' && item.sourceType !== 'background') return false;
      if (source === 'canvas' && item.sourceType !== 'canvas' && item.sourceType !== 'video' && item.sourceType !== 'svg') {
        return false;
      }
    }

    return true;
  });

  // Prune selections no longer visible in current filter
  const visibleSet = new Set(filteredPageImages.map((i) => i.bestSrc));
  for (const url of Array.from(selectedPageUrls)) {
    if (!visibleSet.has(url)) selectedPageUrls.delete(url);
  }

  renderPageGrid();
}

function updatePageSelectionButtons(): void {
  const n = selectedPageUrls.size;
  el('selCountAdd').textContent = String(n);
  el('selCountExp').textContent = String(n);
  el<HTMLButtonElement>('addSelectedBasketBtn').disabled = n === 0;
  el<HTMLButtonElement>('exportSelectedPageBtn').disabled = n === 0 || isExporting;
}

function renderPageGrid(): void {
  const grid = el('pageGrid');
  const status = el('pageStatus');
  el('tabPageCount').textContent = String(filteredPageImages.length);
  grid.innerHTML = '';
  updatePageSelectionButtons();

  if (filteredPageImages.length === 0) {
    status.classList.remove('hidden');
    status.textContent =
      rawPageImages.length === 0
        ? 'Nenhuma foto detectada ainda. Clique em "↻ Escanear" ou "⬇ Auto-Scroll" em páginas infinitas.'
        : 'Nenhuma foto corresponde aos filtros selecionados. Tente reduzir o tamanho mínimo.';
    return;
  }

  status.classList.add('hidden');
  const basketSet = new Set(basket.map((b) => b.bestSrc));
  const frag = document.createDocumentFragment();

  for (const item of filteredPageImages) {
    const isSel = selectedPageUrls.has(item.bestSrc);
    const inBasket = basketSet.has(item.bestSrc);

    const card = document.createElement('div');
    card.className = `t-card ${isSel ? 'selected' : ''} ${inBasket ? 'in-basket' : ''}`;

    const thumb = document.createElement('div');
    thumb.className = 't-thumb';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.inlineDataUrl || item.src;
    img.alt = item.alt || 'Foto';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 't-check';
    cb.checked = isSel;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      if (cb.checked) selectedPageUrls.add(item.bestSrc);
      else selectedPageUrls.delete(item.bestSrc);
      card.classList.toggle('selected', cb.checked);
      updatePageSelectionButtons();
    });

    thumb.addEventListener('click', () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    const dim = document.createElement('span');
    dim.className = 't-dim';
    dim.textContent = `${item.naturalWidth}×${item.naturalHeight}`;

    thumb.appendChild(img);
    thumb.appendChild(cb);
    thumb.appendChild(dim);

    const footer = document.createElement('div');
    footer.className = 't-footer';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = `t-btn ${inBasket ? 'added' : ''}`;
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
      await refreshBasket();
      renderPageGrid();
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 't-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Baixar original agora';
    dlBtn.addEventListener('click', async () => {
      dlBtn.textContent = '...';
      await chrome.runtime.sendMessage({
        type: 'SAVE_SINGLE_NOW',
        src: item.bestSrc,
        inlineDataUrl: item.inlineDataUrl,
        alt: item.alt,
        siteHost: activeHostname,
        tabId: activeTab?.id,
      } satisfies RuntimeMessage);
      dlBtn.textContent = '✓';
    });

    footer.appendChild(addBtn);
    footer.appendChild(dlBtn);
    card.appendChild(thumb);
    card.appendChild(footer);
    frag.appendChild(card);
  }

  grid.appendChild(frag);
}

async function scanActivePage(): Promise<void> {
  const status = el('pageStatus');
  status.classList.remove('hidden');
  status.textContent = 'Escaneando todas as fotos da aba ativa (incluindo Shadow DOM e fundos CSS)...';
  el('pageGrid').innerHTML = '';

  const sent = await sendToActiveTab<{ ok: boolean; images: PageImageItem[] }>({
    type: 'SCAN_PAGE_IMAGES',
    minSize: 48,
  });

  if (!sent || !sent.res?.ok) {
    rawPageImages = [];
    filteredPageImages = [];
    el('tabPageCount').textContent = '0';
    status.textContent = 'Abra qualquer site na web e clique em "↻ Escanear".';
    return;
  }

  activeTab = sent.tab;
  try {
    activeHostname = activeTab.url ? new URL(activeTab.url).hostname.toLowerCase() : 'web';
  } catch {
    activeHostname = 'web';
  }

  rawPageImages = sent.res.images;
  selectedPageUrls.clear();
  applyPageFilters();
}

// --- Auto-Scroll Collector ---
async function toggleAutoScroll(): Promise<void> {
  const btn = el<HTMLButtonElement>('autoScrollBtn');
  const statusBox = el('autoScrollStatus');

  if (autoScrolling) {
    autoScrolling = false;
    btn.classList.remove('running');
    btn.textContent = '⬇ Auto-Scroll';
    await sendToActiveTab({ type: 'AUTO_SCROLL_STOP' });
    return;
  }

  const minSize = Number(el<HTMLSelectElement>('filterMinSize').value) || 120;
  const sent = await sendToActiveTab({
    type: 'AUTO_SCROLL_START',
    minSize,
    maxSteps: 25,
  });

  if (!sent) {
    statusBox.classList.remove('hidden');
    statusBox.textContent = 'Abra uma página web para usar o Auto-Scroll.';
    return;
  }

  activeTab = sent.tab;
  try {
    activeHostname = activeTab.url ? new URL(activeTab.url).hostname.toLowerCase() : 'web';
  } catch {
    activeHostname = 'web';
  }

  autoScrolling = true;
  btn.classList.add('running');
  btn.textContent = '⏹ Parar Scroll';
  statusBox.classList.remove('hidden');
  statusBox.textContent = 'Rolando página e coletando fotos lazy-loaded...';
}

// --- Basket Tab ---
async function refreshBasket(): Promise<void> {
  basket = await getBasket();
  el('tabBasketCount').textContent = String(basket.length);

  const exportBtn = el<HTMLButtonElement>('exportBasketAllBtn');
  const clearBtn = el<HTMLButtonElement>('basketClearBtn');
  const emptyBox = el('basketEmpty');
  const grid = el('basketGrid');

  const mode = el<HTMLSelectElement>('basketExportMode').value as ExportMode;
  const modeSuffix = mode === 'zip' ? '→ .ZIP' : '→ Pasta';
  exportBtn.textContent = `📦 Exportar Toda a Cesta (${basket.length} foto${basket.length === 1 ? '' : 's'} ${modeSuffix})`;
  exportBtn.disabled = basket.length === 0 || isExporting;
  clearBtn.disabled = basket.length === 0 || isExporting;

  emptyBox.classList.toggle('hidden', basket.length > 0);
  grid.innerHTML = '';

  if (basket.length === 0) return;

  const frag = document.createDocumentFragment();
  for (const item of basket) {
    const card = document.createElement('div');
    card.className = 't-card';

    const thumb = document.createElement('div');
    thumb.className = 't-thumb';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.inlineDataUrl || item.src;
    img.alt = item.alt || 'Foto na cesta';

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 't-remove-btn';
    rmBtn.textContent = '✕';
    rmBtn.title = 'Remover da cesta';
    rmBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'BASKET_REMOVE',
        bestSrcs: [item.bestSrc],
      } satisfies RuntimeMessage);
      await refreshBasket();
      renderPageGrid();
    });

    if (item.siteHost) {
      const site = document.createElement('span');
      site.className = 't-site';
      site.textContent = item.siteHost.replace(/^www\./, '');
      thumb.appendChild(site);
    }

    if (item.naturalWidth > 0) {
      const dim = document.createElement('span');
      dim.className = 't-dim';
      dim.textContent = `${item.naturalWidth}×${item.naturalHeight}`;
      thumb.appendChild(dim);
    }

    thumb.appendChild(img);
    thumb.appendChild(rmBtn);
    card.appendChild(thumb);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

// --- Bulk Export Execution ---
async function executeExport(items: BasketImageItem[], mode: ExportMode, label: string, clearBasketOnDone = false): Promise<void> {
  if (items.length === 0 || isExporting) return;
  isExporting = true;
  exportAbort = new AbortController();

  const banner = el('exportBanner');
  const text = el('exportBannerText');
  const fill = el<HTMLDivElement>('exportFill');
  const cancelBtn = el<HTMLButtonElement>('cancelExportBtn');

  banner.className = 'export-banner';
  cancelBtn.classList.remove('hidden');
  fill.style.width = '5%';
  text.textContent = `Iniciando exportação de ${items.length} foto(s)...`;
  updatePageSelectionButtons();
  el<HTMLButtonElement>('exportBasketAllBtn').disabled = true;

  try {
    const result = await runBulkExport({
      items,
      mode,
      label,
      includeManifestInZip: settings.includeManifestInZip,
      signal: exportAbort.signal,
      onProgress: (p) => {
        const pct =
          p.stage === 'packing'
            ? 92
            : p.stage === 'downloading'
              ? 97
              : p.stage === 'done'
                ? 100
                : Math.round((p.completed / Math.max(1, p.total)) * 88);
        fill.style.width = `${Math.max(5, pct)}%`;
        text.textContent = `${p.message} (${formatBytes(p.totalBytes)})`;
      },
    });

    banner.classList.add('success');
    cancelBtn.classList.add('hidden');
    fill.style.width = '100%';
    const failedNote = result.failed > 0 ? ` · ${result.failed} ignoradas` : '';
    text.textContent = `✅ ${result.succeeded} foto(s) salvas (${formatBytes(result.totalBytes)}) em ${(result.elapsedMs / 1000).toFixed(1)}s${failedNote}`;

    if (clearBasketOnDone) {
      await chrome.runtime.sendMessage({ type: 'BASKET_CLEAR' } satisfies RuntimeMessage);
      await refreshBasket();
      renderPageGrid();
    }
    await renderHistory();
  } catch (err) {
    cancelBtn.classList.add('hidden');
    if (err instanceof DOMException && err.name === 'AbortError') {
      banner.classList.add('error');
      text.textContent = 'Exportação cancelada.';
    } else {
      banner.classList.add('error');
      text.textContent = `❌ ${err instanceof Error ? err.message : 'Erro na exportação.'}`;
    }
  } finally {
    isExporting = false;
    exportAbort = null;
    updatePageSelectionButtons();
    await refreshBasket();
  }
}

// --- Settings & History ---
function renderMutedDomains(): void {
  const box = el('mutedDomainsBox');
  const list = el('mutedDomainsList');
  list.innerHTML = '';

  if (settings.disabledHoverDomains.length === 0) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  for (const domain of settings.disabledHoverDomains) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'muted-chip';
    chip.textContent = `${domain} ✕`;
    chip.addEventListener('click', async () => {
      const { settings: next } = await toggleDomainHoverMute(domain);
      settings = next;
      renderMutedDomains();
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings } satisfies RuntimeMessage).catch(() => {});
    });
    list.appendChild(chip);
  }
}

async function updateSettingsFromUI(partial: Partial<ExtensionSettings>): Promise<void> {
  settings = await saveSettings(partial);
  el<HTMLSelectElement>('basketExportMode').value = settings.exportMode;
  el<HTMLSelectElement>('cfgExportMode').value = settings.exportMode;
  await refreshBasket();
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings } satisfies RuntimeMessage).catch(() => {});

  const toast = el('savedToast');
  toast.textContent = '✓ Preferências salvas';
  setTimeout(() => {
    toast.textContent = '';
  }, 1800);
}

async function renderHistory(): Promise<void> {
  const listEl = el('historyList');
  const entries = await getExportHistory();
  listEl.innerHTML = '';

  if (entries.length === 0) {
    listEl.innerHTML = '<div class="empty-note">Nenhuma exportação realizada ainda.</div>';
    return;
  }

  for (const item of entries) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = item.filename;
    name.title = item.filename;

    const meta = document.createElement('div');
    meta.className = 'history-meta tabular';
    const left = document.createElement('span');
    left.textContent = `${item.succeeded}/${item.totalRequested} fotos · ${item.mode.toUpperCase()}`;
    const right = document.createElement('span');
    right.textContent = formatBytes(item.totalBytes);

    meta.appendChild(left);
    meta.appendChild(right);
    row.appendChild(name);
    row.appendChild(meta);
    listEl.appendChild(row);
  }
}

// --- Init ---
async function initSidePanel(): Promise<void> {
  settings = await getSettings();

  el<HTMLSelectElement>('cfgExportMode').value = settings.exportMode;
  el<HTMLSelectElement>('basketExportMode').value = settings.exportMode;
  el<HTMLInputElement>('cfgUpgradeUrls').checked = settings.upgradeThumbnailUrls;
  el<HTMLInputElement>('cfgHoverButton').checked = settings.showHoverButton;
  el<HTMLInputElement>('cfgIncludeManifest').checked = settings.includeManifestInZip;
  renderMutedDomains();

  // Tabs
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab as 'page' | 'basket' | 'settings'));
  });

  // Header multi-click collector button
  el('headerPickerBtn').addEventListener('click', async () => {
    await sendToActiveTab({ type: 'TOGGLE_PICKER', active: true });
  });

  // Page scanner & filters
  el('scanPageBtn').addEventListener('click', () => void scanActivePage());
  el('autoScrollBtn').addEventListener('click', () => void toggleAutoScroll());
  el('filterMinSize').addEventListener('change', applyPageFilters);
  el('filterOrientation').addEventListener('change', applyPageFilters);
  el('filterSource').addEventListener('change', applyPageFilters);

  el('selectAllPageBtn').addEventListener('click', () => {
    const allSelected =
      selectedPageUrls.size === filteredPageImages.length && filteredPageImages.length > 0;
    selectedPageUrls.clear();
    if (!allSelected) {
      for (const item of filteredPageImages) selectedPageUrls.add(item.bestSrc);
    }
    renderPageGrid();
  });

  el('addSelectedBasketBtn').addEventListener('click', async () => {
    const chosen = filteredPageImages.filter((i) => selectedPageUrls.has(i.bestSrc));
    if (chosen.length === 0) return;
    await chrome.runtime.sendMessage({
      type: 'BASKET_ADD',
      items: chosen.map(toBasketItem),
      silent: true,
    } satisfies RuntimeMessage);
    await refreshBasket();
    renderPageGrid();
  });

  el('exportSelectedPageBtn').addEventListener('click', () => {
    const chosen = filteredPageImages
      .filter((i) => selectedPageUrls.has(i.bestSrc))
      .map(toBasketItem);
    void executeExport(chosen, settings.exportMode, activeHostname, false);
  });

  // Basket controls
  el<HTMLSelectElement>('basketExportMode').addEventListener('change', async (e) => {
    await updateSettingsFromUI({ exportMode: (e.target as HTMLSelectElement).value as ExportMode });
  });

  el('exportBasketAllBtn').addEventListener('click', () => {
    const clearAfter = el<HTMLInputElement>('clearAfterExportChk').checked;
    const mode = el<HTMLSelectElement>('basketExportMode').value as ExportMode;
    const hosts = new Set(basket.map((i) => i.siteHost).filter(Boolean));
    const label = hosts.size === 1 ? Array.from(hosts)[0] : 'multi-sites';
    void executeExport(basket, mode, label, clearAfter);
  });

  el('basketClearBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'BASKET_CLEAR' } satisfies RuntimeMessage);
    await refreshBasket();
    renderPageGrid();
  });

  el('cancelExportBtn').addEventListener('click', () => {
    exportAbort?.abort();
  });

  // Settings controls
  el<HTMLSelectElement>('cfgExportMode').addEventListener('change', (e) => {
    void updateSettingsFromUI({ exportMode: (e.target as HTMLSelectElement).value as ExportMode });
  });
  el<HTMLInputElement>('cfgUpgradeUrls').addEventListener('change', (e) => {
    void updateSettingsFromUI({ upgradeThumbnailUrls: (e.target as HTMLInputElement).checked });
  });
  el<HTMLInputElement>('cfgHoverButton').addEventListener('change', (e) => {
    void updateSettingsFromUI({ showHoverButton: (e.target as HTMLInputElement).checked });
  });
  el<HTMLInputElement>('cfgIncludeManifest').addEventListener('change', (e) => {
    void updateSettingsFromUI({ includeManifestInZip: (e.target as HTMLInputElement).checked });
  });
  el('clearHistoryBtn').addEventListener('click', async () => {
    await clearExportHistory();
    await renderHistory();
  });

  // Live updates from content script & service worker
  chrome.runtime.onMessage.addListener((msg: RuntimeMessage) => {
    if (msg.type === 'BASKET_UPDATED') {
      void refreshBasket().then(() => renderPageGrid());
    } else if (msg.type === 'AUTO_SCROLL_PROGRESS') {
      const statusBox = el('autoScrollStatus');
      statusBox.classList.remove('hidden');
      if (!msg.done) {
        statusBox.textContent = `Rolando (passo ${msg.step}) · ${msg.foundCount} fotos encontradas...`;
      } else {
        autoScrolling = false;
        const btn = el<HTMLButtonElement>('autoScrollBtn');
        btn.classList.remove('running');
        btn.textContent = '⬇ Auto-Scroll';
        statusBox.textContent = `✅ Auto-Scroll finalizado: ${msg.foundCount} fotos encontradas nesta página!`;
        if (msg.images) {
          rawPageImages = msg.images;
          applyPageFilters();
        }
      }
    }
  });

  await refreshBasket();
  await scanActivePage();
}

void initSidePanel();
