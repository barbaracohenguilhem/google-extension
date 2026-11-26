import { RuntimeMessage } from '../shared/messages';
import { getBasket, getSettings } from '../shared/storage';
import {
  BasketImageItem,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  PageImageItem,
} from '../shared/types';

declare global {
  interface Window {
    __LUMINA_BULK_CONTENT_LOADED__?: boolean;
  }
}

if (!window.__LUMINA_BULK_CONTENT_LOADED__) {
  window.__LUMINA_BULK_CONTENT_LOADED__ = true;
  initLuminaCollector();
}

interface DetectedTarget {
  element: Element;
  rect: DOMRect;
  item: PageImageItem;
}

function initLuminaCollector(): void {
  let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  let basketSrcSet = new Set<string>();
  let pickerActive = false;
  let pickerSessionCount = 0;
  let autoScrollRunning = false;
  let currentHoverTarget: DetectedTarget | null = null;
  let isPointerOverPill = false;
  let hidePillTimer: number | null = null;
  let rafPending = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  let hostEl: HTMLDivElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let hoverPillEl: HTMLDivElement | null = null;
  let hoverAddBtn: HTMLButtonElement | null = null;
  let pickerOverlayEl: HTMLDivElement | null = null;
  let pickerHudEl: HTMLDivElement | null = null;
  let pickerCountLabel: HTMLSpanElement | null = null;
  let toastStackEl: HTMLDivElement | null = null;

  function isHoverEnabledHere(): boolean {
    if (!settings.showHoverButton) return false;
    const host = window.location.hostname.toLowerCase();
    return !settings.disabledHoverDomains.includes(host);
  }

  function ensureShadowUI(): ShadowRoot {
    if (shadowRoot && hostEl && document.documentElement.contains(hostEl)) {
      return shadowRoot;
    }

    hostEl = document.createElement('div');
    hostEl.id = 'lumina-bulk-shadow-host';
    hostEl.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(hostEl);
    shadowRoot = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; }

      .lumina-pill {
        position: fixed;
        pointer-events: auto;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(11, 14, 22, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.40);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        color: #F8FAFC;
        z-index: 2147483647;
        user-select: none;
      }
      .lumina-pill.visible { display: flex; }

      .lumina-add-btn {
        border: none;
        background: linear-gradient(135deg, #0EA5E9, #6366F1);
        color: #FFFFFF;
        font-size: 11.5px;
        font-weight: 700;
        padding: 5px 11px;
        border-radius: 999px;
        cursor: pointer;
        white-space: nowrap;
        transition: filter 0.12s ease, transform 0.1s ease;
      }
      .lumina-add-btn:hover { filter: brightness(1.1); }
      .lumina-add-btn.added {
        background: linear-gradient(135deg, #059669, #10B981);
      }

      .lumina-dl-btn {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #E2E8F0;
        width: 26px;
        height: 26px;
        border-radius: 999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
      .lumina-dl-btn:hover { background: rgba(56, 189, 248, 0.24); border-color: rgba(56, 189, 248, 0.6); color: #FFF; }

      .lumina-picker-banner {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: auto;
        display: none;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        border-radius: 14px;
        background: rgba(11, 14, 22, 0.95);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(56, 189, 248, 0.55);
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.58);
        color: #F8FAFC;
        font-size: 12.5px;
        font-weight: 600;
        z-index: 2147483647;
      }
      .lumina-picker-banner.active { display: flex; }
      .lumina-picker-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #38BDF8;
        box-shadow: 0 0 10px #38BDF8;
      }
      .lumina-picker-count {
        background: rgba(16, 185, 129, 0.18);
        border: 1px solid rgba(16, 185, 129, 0.45);
        color: #6EE7B7;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
      }
      .lumina-picker-done {
        border: none;
        background: linear-gradient(135deg, #0EA5E9, #6366F1);
        color: #FFFFFF;
        font-size: 11px;
        font-weight: 700;
        padding: 5px 10px;
        border-radius: 8px;
        cursor: pointer;
      }

      .lumina-highlight {
        position: fixed;
        pointer-events: none;
        display: none;
        border: 2px solid #38BDF8;
        background: rgba(56, 189, 248, 0.11);
        box-shadow: 0 0 0 2px rgba(11, 14, 22, 0.6), 0 0 20px rgba(56, 189, 248, 0.38);
        border-radius: 6px;
        z-index: 2147483646;
      }
      .lumina-highlight-tag {
        position: absolute;
        left: 6px;
        bottom: 6px;
        background: rgba(11, 14, 22, 0.92);
        color: #E0F2FE;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .lumina-flash {
        position: fixed;
        pointer-events: none;
        border: 3px solid #10B981;
        background: rgba(16, 185, 129, 0.22);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #FFFFFF;
        font-size: 13px;
        font-weight: 800;
        text-shadow: 0 2px 8px rgba(0,0,0,0.8);
        z-index: 2147483647;
        animation: luminaPop 0.55s ease forwards;
      }
      @keyframes luminaPop {
        0% { opacity: 1; transform: scale(0.98); }
        70% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.02); }
      }

      .lumina-toasts {
        position: fixed;
        right: 18px;
        bottom: 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 300px;
        pointer-events: none;
        z-index: 2147483647;
      }
      .lumina-toast {
        pointer-events: auto;
        background: rgba(13, 17, 27, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.35);
        border-radius: 12px;
        padding: 10px 13px;
        color: #F8FAFC;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      .lumina-toast.success { border-color: rgba(16, 185, 129, 0.55); }
      .lumina-toast.error { border-color: rgba(239, 68, 68, 0.55); }
      .lumina-toast-title { font-size: 12.5px; font-weight: 700; }
      .lumina-toast-sub { font-size: 11px; color: #94A3B8; margin-top: 2px; word-break: break-word; }
    `;
    shadowRoot.appendChild(style);

    // 1. Hover Action Pill
    hoverPillEl = document.createElement('div');
    hoverPillEl.className = 'lumina-pill';

    hoverAddBtn = document.createElement('button');
    hoverAddBtn.type = 'button';
    hoverAddBtn.className = 'lumina-add-btn';
    hoverAddBtn.textContent = '➕ Cesta';
    hoverAddBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentHoverTarget) return;
      const target = currentHoverTarget;
      await addTargetToBasket(target, false);
      updateHoverAddButtonState(target.item.bestSrc);
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'lumina-dl-btn';
    dlBtn.textContent = '⬇';
    dlBtn.title = 'Baixar original em resolução máxima agora';
    dlBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentHoverTarget) return;
      const target = currentHoverTarget;
      hideHoverPill();
      const inlineDataUrl = await captureInlineDataUrlIfNeeded(target);
      chrome.runtime
        .sendMessage({
          type: 'SAVE_SINGLE_NOW',
          src: target.item.bestSrc,
          inlineDataUrl,
          alt: target.item.alt,
          siteHost: window.location.hostname,
        } satisfies RuntimeMessage)
        .catch(() => {});
    });

    hoverPillEl.appendChild(hoverAddBtn);
    hoverPillEl.appendChild(dlBtn);

    hoverPillEl.addEventListener('mouseenter', () => {
      isPointerOverPill = true;
      if (hidePillTimer !== null) {
        clearTimeout(hidePillTimer);
        hidePillTimer = null;
      }
    });
    hoverPillEl.addEventListener('mouseleave', () => {
      isPointerOverPill = false;
      scheduleHidePill();
    });
    shadowRoot.appendChild(hoverPillEl);

    // 2. Multi-Click Collector Banner & Highlight Box
    pickerHudEl = document.createElement('div');
    pickerHudEl.className = 'lumina-picker-banner';

    const dot = document.createElement('span');
    dot.className = 'lumina-picker-dot';
    const label = document.createElement('span');
    label.textContent = 'Coletor Multi-Clique — Clique em quantas fotos quiser';

    pickerCountLabel = document.createElement('span');
    pickerCountLabel.className = 'lumina-picker-count';
    pickerCountLabel.textContent = '0 coletadas';

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'lumina-picker-done';
    doneBtn.textContent = 'Concluir (ESC)';
    doneBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPickerActive(false);
    });

    pickerHudEl.appendChild(dot);
    pickerHudEl.appendChild(label);
    pickerHudEl.appendChild(pickerCountLabel);
    pickerHudEl.appendChild(doneBtn);
    shadowRoot.appendChild(pickerHudEl);

    pickerOverlayEl = document.createElement('div');
    pickerOverlayEl.className = 'lumina-highlight';
    const tag = document.createElement('div');
    tag.className = 'lumina-highlight-tag';
    pickerOverlayEl.appendChild(tag);
    shadowRoot.appendChild(pickerOverlayEl);

    // 3. Toast Stack
    toastStackEl = document.createElement('div');
    toastStackEl.className = 'lumina-toasts';
    shadowRoot.appendChild(toastStackEl);

    return shadowRoot;
  }

  function updateHoverAddButtonState(bestSrc: string): void {
    if (!hoverAddBtn) return;
    const isAdded = basketSrcSet.has(bestSrc);
    hoverAddBtn.classList.toggle('added', isAdded);
    hoverAddBtn.textContent = isAdded ? '✓ Na Cesta' : '➕ Cesta';
  }

  function flashCollectedRect(rect: DOMRect): void {
    const sr = ensureShadowUI();
    const el = document.createElement('div');
    el.className = 'lumina-flash';
    el.style.left = `${Math.round(rect.left)}px`;
    el.style.top = `${Math.round(rect.top)}px`;
    el.style.width = `${Math.round(rect.width)}px`;
    el.style.height = `${Math.round(rect.height)}px`;
    el.textContent = '✓ Adicionada à Cesta';
    sr.appendChild(el);
    window.setTimeout(() => el.remove(), 580);
  }

  // --- URL, Srcset & Retina image-set() Helpers ---
  function resolveUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('javascript:')) return '';
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
    try {
      return new URL(trimmed, window.location.href).href;
    } catch {
      return '';
    }
  }

  function pickBestFromSrcset(srcset: string | null | undefined): string {
    if (!srcset) return '';
    let bestUrl = '';
    let bestScore = -1;
    const regex = /([^\s,]+(?:\S*[^\s,])?)(?:\s+(\d+(?:\.\d+)?)(w|x))?(?:\s*,|\s*$)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(srcset)) !== null) {
      const candidate = resolveUrl(match[1]);
      if (!candidate) continue;
      const val = match[2] ? parseFloat(match[2]) : 1;
      const unit = match[3] || 'x';
      const score = unit === 'w' ? val : val * 1000;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = candidate;
      }
    }
    return bestUrl;
  }

  function extractCssBgUrl(bgValue: string): string {
    if (!bgValue || bgValue === 'none') return '';
    if (/image-set\(/i.test(bgValue)) {
      const setRegex = /url\(\s*(['"]?)(.*?)\1\s*\)\s*(\d+(?:\.\d+)?)x/gi;
      let best = '';
      let bestDpr = -1;
      let m: RegExpExecArray | null;
      while ((m = setRegex.exec(bgValue)) !== null) {
        const candidate = resolveUrl(m[2]);
        const dpr = parseFloat(m[3]) || 1;
        if (candidate && dpr > bestDpr) {
          bestDpr = dpr;
          best = candidate;
        }
      }
      if (best) return best;
    }
    const match = bgValue.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
    return match && match[2] ? resolveUrl(match[2]) : '';
  }

  function extractImageFromElement(el: Element, minSize = 48): DetectedTarget | null {
    const rect = el.getBoundingClientRect();
    if (rect.width < minSize || rect.height < minSize) return null;

    if (el instanceof HTMLImageElement) {
      const parentPic = el.closest('picture');
      let bestFromPicture = '';
      if (parentPic) {
        for (const s of Array.from(parentPic.querySelectorAll('source'))) {
          const picked = pickBestFromSrcset(s.getAttribute('srcset'));
          if (picked) {
            bestFromPicture = picked;
            break;
          }
        }
      }

      const bestFromSrcset =
        pickBestFromSrcset(el.getAttribute('srcset')) ||
        pickBestFromSrcset(el.getAttribute('data-srcset'));

      const lazyUrl =
        resolveUrl(el.getAttribute('data-original') || '') ||
        resolveUrl(el.getAttribute('data-full-src') || '') ||
        resolveUrl(el.getAttribute('data-zoom-image') || '') ||
        resolveUrl(el.getAttribute('data-large_image') || '') ||
        resolveUrl(el.getAttribute('data-src') || '') ||
        resolveUrl(el.getAttribute('data-lazy-src') || '');

      const currentUrl = resolveUrl(el.currentSrc || el.src || '');
      const bestSrc = bestFromSrcset || bestFromPicture || lazyUrl || currentUrl;
      const displaySrc = currentUrl || bestSrc;

      if (!displaySrc) return null;
      const natW = el.naturalWidth || Math.round(rect.width);
      const natH = el.naturalHeight || Math.round(rect.height);
      if (natW < minSize && natH < minSize) return null;

      return {
        element: el,
        rect,
        item: {
          id: `img-${bestSrc.slice(0, 80)}-${natW}x${natH}`,
          src: displaySrc,
          bestSrc: bestSrc || displaySrc,
          alt: el.alt || el.title || '',
          sourceType: parentPic ? 'picture' : 'img',
          naturalWidth: natW,
          naturalHeight: natH,
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
        },
      };
    }

    if (el instanceof HTMLCanvasElement && el.width >= minSize && el.height >= minSize) {
      return {
        element: el,
        rect,
        item: {
          id: `canvas-${el.width}x${el.height}-${Math.round(rect.left)}-${Math.round(rect.top)}`,
          src: `canvas://${el.width}x${el.height}`,
          bestSrc: `canvas://${el.width}x${el.height}`,
          alt: el.getAttribute('aria-label') || 'canvas-image',
          sourceType: 'canvas',
          naturalWidth: el.width,
          naturalHeight: el.height,
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
        },
      };
    }

    if (el instanceof HTMLVideoElement) {
      const poster = resolveUrl(el.poster || '');
      if (poster) {
        return {
          element: el,
          rect,
          item: {
            id: `video-${poster.slice(0, 80)}`,
            src: poster,
            bestSrc: poster,
            alt: el.getAttribute('aria-label') || 'video-poster',
            sourceType: 'video',
            naturalWidth: el.videoWidth || Math.round(rect.width),
            naturalHeight: el.videoHeight || Math.round(rect.height),
            renderedWidth: Math.round(rect.width),
            renderedHeight: Math.round(rect.height),
          },
        };
      }
      if (el.readyState >= 2 && el.videoWidth >= minSize) {
        return {
          element: el,
          rect,
          item: {
            id: `video-frame-${el.videoWidth}x${el.videoHeight}`,
            src: `video-frame://${el.videoWidth}x${el.videoHeight}`,
            bestSrc: `video-frame://${el.videoWidth}x${el.videoHeight}`,
            alt: 'video-frame',
            sourceType: 'video',
            naturalWidth: el.videoWidth,
            naturalHeight: el.videoHeight,
            renderedWidth: Math.round(rect.width),
            renderedHeight: Math.round(rect.height),
          },
        };
      }
    }

    const style = window.getComputedStyle(el);
    const bgUrl = extractCssBgUrl(style.backgroundImage);
    if (bgUrl) {
      return {
        element: el,
        rect,
        item: {
          id: `bg-${bgUrl.slice(0, 80)}`,
          src: bgUrl,
          bestSrc: bgUrl,
          alt: el.getAttribute('aria-label') || el.getAttribute('title') || 'background-image',
          sourceType: 'background',
          naturalWidth: Math.round(rect.width),
          naturalHeight: Math.round(rect.height),
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
        },
      };
    }

    if (el instanceof SVGSVGElement && rect.width >= 96 && rect.height >= 96) {
      return {
        element: el,
        rect,
        item: {
          id: `svg-${Math.round(rect.width)}x${Math.round(rect.height)}-${Math.round(rect.top)}`,
          src: `svg://${Math.round(rect.width)}x${Math.round(rect.height)}`,
          bestSrc: `svg://${Math.round(rect.width)}x${Math.round(rect.height)}`,
          alt: el.getAttribute('aria-label') || 'svg-graphic',
          sourceType: 'svg',
          naturalWidth: Math.round(rect.width),
          naturalHeight: Math.round(rect.height),
          renderedWidth: Math.round(rect.width),
          renderedHeight: Math.round(rect.height),
        },
      };
    }

    return null;
  }

  function collectElementsAtPointDeep(
    root: Document | ShadowRoot,
    x: number,
    y: number,
    out: Element[],
    depth = 0
  ): void {
    if (depth > 5) return;
    for (const el of root.elementsFromPoint(x, y)) {
      if (el === hostEl) continue;
      out.push(el);
      if (el.shadowRoot && el.shadowRoot !== shadowRoot) {
        collectElementsAtPointDeep(el.shadowRoot, x, y, out, depth + 1);
      }
    }
  }

  function findTargetAtPoint(x: number, y: number, minSize: number): DetectedTarget | null {
    const stack: Element[] = [];
    collectElementsAtPointDeep(document, x, y, stack);

    for (const el of stack) {
      const found = extractImageFromElement(el, minSize);
      if (found) return found;

      if (el.children.length <= 3) {
        const innerImg = el.querySelector('img');
        if (innerImg) {
          const innerRect = innerImg.getBoundingClientRect();
          if (x >= innerRect.left && x <= innerRect.right && y >= innerRect.top && y <= innerRect.bottom) {
            const innerFound = extractImageFromElement(innerImg, minSize);
            if (innerFound) return innerFound;
          }
        }
      }
    }
    return null;
  }

  async function captureInlineDataUrlIfNeeded(target: DetectedTarget): Promise<string | undefined> {
    const { element, item } = target;
    if (item.inlineDataUrl) return item.inlineDataUrl;

    try {
      if (element instanceof HTMLCanvasElement) {
        return element.toDataURL('image/png');
      }
      if (element instanceof HTMLVideoElement && item.bestSrc.startsWith('video-frame://')) {
        const c = document.createElement('canvas');
        c.width = element.videoWidth || item.naturalWidth;
        c.height = element.videoHeight || item.naturalHeight;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(element, 0, 0, c.width, c.height);
          return c.toDataURL('image/png');
        }
      }
      if (element instanceof SVGSVGElement) {
        const serializer = new XMLSerializer();
        const svgBlob = new Blob([serializer.serializeToString(element)], {
          type: 'image/svg+xml;charset=utf-8',
        });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('SVG load error'));
            i.src = svgUrl;
          });
          const c = document.createElement('canvas');
          c.width = Math.max(256, Math.round(item.renderedWidth * 2));
          c.height = Math.max(256, Math.round(item.renderedHeight * 2));
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
          }
        } finally {
          URL.revokeObjectURL(svgUrl);
        }
      }
      if (item.bestSrc.startsWith('blob:')) {
        const resp = await fetch(item.bestSrc);
        const blob = await resp.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Blob read error'));
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Fallback to service worker fetch
    }
    return undefined;
  }

  async function addTargetToBasket(target: DetectedTarget, silent = true): Promise<void> {
    const inlineDataUrl = await captureInlineDataUrlIfNeeded(target);
    const basketItem: BasketImageItem = {
      ...target.item,
      inlineDataUrl,
      pageUrl: window.location.href,
      pageTitle: document.title,
      siteHost: window.location.hostname,
      addedAt: Date.now(),
    };
    basketSrcSet.add(basketItem.bestSrc);
    await chrome.runtime.sendMessage({
      type: 'BASKET_ADD',
      items: [basketItem],
      silent,
    } satisfies RuntimeMessage);
  }

  async function fetchImageInPageContext(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.ok) {
        const blob = await resp.blob();
        if (blob.size > 128) {
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Read error'));
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch {
      // Fallback to rendered <img> canvas
    }
    try {
      const matched = Array.from(document.querySelectorAll('img')).find(
        (i) => i.currentSrc === url || i.src === url
      );
      if (matched && matched.complete && matched.naturalWidth > 0) {
        const c = document.createElement('canvas');
        c.width = matched.naturalWidth;
        c.height = matched.naturalHeight;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(matched, 0, 0);
          return c.toDataURL('image/png');
        }
      }
    } catch {
      // tainted cross-origin canvas
    }
    return null;
  }

  function showHoverPill(target: DetectedTarget): void {
    ensureShadowUI();
    if (!hoverPillEl) return;
    currentHoverTarget = target;
    updateHoverAddButtonState(target.item.bestSrc);

    const r = target.rect;
    const pillWidth = 128;
    const pillHeight = 34;

    let left = r.right - pillWidth - 8;
    let top = r.top + 8;

    if (left < 8) left = Math.max(8, r.left + 8);
    if (left + pillWidth > window.innerWidth - 8) left = window.innerWidth - pillWidth - 8;
    if (top < 8) top = Math.min(window.innerHeight - pillHeight - 8, Math.max(8, r.bottom - pillHeight - 8));
    if (top + pillHeight > window.innerHeight - 8) top = window.innerHeight - pillHeight - 8;

    hoverPillEl.style.left = `${Math.round(left)}px`;
    hoverPillEl.style.top = `${Math.round(top)}px`;
    hoverPillEl.classList.add('visible');
  }

  function hideHoverPill(): void {
    if (hoverPillEl) hoverPillEl.classList.remove('visible');
    currentHoverTarget = null;
  }

  function scheduleHidePill(): void {
    if (hidePillTimer !== null) clearTimeout(hidePillTimer);
    hidePillTimer = window.setTimeout(() => {
      if (!isPointerOverPill) hideHoverPill();
      hidePillTimer = null;
    }, 200);
  }

  function setPickerActive(next: boolean): void {
    ensureShadowUI();
    pickerActive = next;
    if (pickerActive) {
      pickerSessionCount = 0;
      if (pickerCountLabel) pickerCountLabel.textContent = '0 coletadas';
      hideHoverPill();
      document.documentElement.style.cursor = 'crosshair';
    } else {
      document.documentElement.style.cursor = '';
      if (pickerOverlayEl) pickerOverlayEl.style.display = 'none';
    }
    if (pickerHudEl) pickerHudEl.classList.toggle('active', pickerActive);
  }

  function updateHighlightAt(x: number, y: number): void {
    if (!pickerOverlayEl) return;
    const found = findTargetAtPoint(x, y, 36);
    if (!found) {
      pickerOverlayEl.style.display = 'none';
      return;
    }
    const r = found.rect;
    pickerOverlayEl.style.display = 'block';
    pickerOverlayEl.style.left = `${Math.round(r.left)}px`;
    pickerOverlayEl.style.top = `${Math.round(r.top)}px`;
    pickerOverlayEl.style.width = `${Math.round(r.width)}px`;
    pickerOverlayEl.style.height = `${Math.round(r.height)}px`;

    const tag = pickerOverlayEl.querySelector('.lumina-highlight-tag');
    if (tag) {
      const already = basketSrcSet.has(found.item.bestSrc) ? ' · ✓ Já na cesta' : '';
      tag.textContent = `${found.item.sourceType.toUpperCase()} · ${found.item.naturalWidth}×${found.item.naturalHeight}px${already}`;
    }
  }

  function handlePointerUpdate(): void {
    rafPending = false;
    if (pickerActive) {
      updateHighlightAt(lastPointerX, lastPointerY);
      return;
    }
    if (!isHoverEnabledHere() || isPointerOverPill) return;

    const target = findTargetAtPoint(lastPointerX, lastPointerY, settings.minHoverImageSize);
    if (target) {
      if (hidePillTimer !== null) {
        clearTimeout(hidePillTimer);
        hidePillTimer = null;
      }
      showHoverPill(target);
    } else if (currentHoverTarget) {
      scheduleHidePill();
    }
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(handlePointerUpdate);
      }
    },
    { passive: true }
  );

  window.addEventListener(
    'scroll',
    () => {
      if (!isPointerOverPill) hideHoverPill();
      if (pickerActive) updateHighlightAt(lastPointerX, lastPointerY);
    },
    { passive: true }
  );

  // Multi-Click Collector stays active across clicks until user presses ESC or Done!
  window.addEventListener(
    'click',
    (e) => {
      if (!pickerActive) return;
      if (e.composedPath().includes(hostEl as EventTarget)) return;

      const found = findTargetAtPoint(e.clientX, e.clientY, 36);
      if (found) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        pickerSessionCount++;
        if (pickerCountLabel) pickerCountLabel.textContent = `${pickerSessionCount} coletadas`;
        flashCollectedRect(found.rect);
        void addTargetToBasket(found, true);
      }
    },
    true
  );

  window.addEventListener('keydown', (e) => {
    if (pickerActive && e.key === 'Escape') {
      e.preventDefault();
      setPickerActive(false);
    }
  });

  // --- Deep Page Scanner (Document + Open Shadow DOMs, Batched via rAF) ---
  function collectDeepCandidates(root: ParentNode, out: Element[], depth = 0): void {
    if (depth > 4 || out.length > 6000) return;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el === hostEl) continue;
      if (
        el instanceof HTMLImageElement ||
        el instanceof HTMLCanvasElement ||
        el instanceof HTMLVideoElement ||
        el instanceof SVGSVGElement ||
        el.tagName === 'DIV' ||
        el.tagName === 'SECTION' ||
        el.tagName === 'FIGURE' ||
        el.tagName === 'A' ||
        el.tagName === 'SPAN' ||
        el.tagName === 'ARTICLE' ||
        el.tagName === 'LI'
      ) {
        out.push(el);
      }
      if (el.shadowRoot && el.shadowRoot !== shadowRoot) {
        collectDeepCandidates(el.shadowRoot, out, depth + 1);
      }
    }
  }

  async function scanAllPageImages(minSize = 64): Promise<PageImageItem[]> {
    const candidates: Element[] = [];
    collectDeepCandidates(document, candidates);

    const seen = new Set<string>();
    const results: PageImageItem[] = [];
    const BATCH = 180;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          for (const el of slice) {
            if (el === hostEl) continue;
            if (
              !(el instanceof HTMLImageElement) &&
              !(el instanceof HTMLCanvasElement) &&
              !(el instanceof HTMLVideoElement) &&
              !(el instanceof SVGSVGElement)
            ) {
              const r = el.getBoundingClientRect();
              if (r.width < minSize || r.height < minSize) continue;
            }

            const detected = extractImageFromElement(el, minSize);
            if (!detected) continue;

            const key = detected.item.bestSrc;
            if (seen.has(key)) continue;
            seen.add(key);

            if (el instanceof HTMLCanvasElement) {
              try {
                detected.item.inlineDataUrl = el.toDataURL('image/png');
              } catch {
                continue;
              }
            } else if (el instanceof HTMLImageElement && detected.item.bestSrc.startsWith('blob:')) {
              try {
                const c = document.createElement('canvas');
                c.width = el.naturalWidth || detected.item.renderedWidth;
                c.height = el.naturalHeight || detected.item.renderedHeight;
                const ctx = c.getContext('2d');
                if (ctx && c.width > 0 && c.height > 0) {
                  ctx.drawImage(el, 0, 0, c.width, c.height);
                  detected.item.inlineDataUrl = c.toDataURL('image/png');
                }
              } catch {
                // ignore tainted blob
              }
            }

            results.push(detected.item);
          }
          resolve();
        });
      });
    }

    results.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    return results.slice(0, 300);
  }

  // --- Smart Auto-Scroll Collector (for Infinite-Scroll / Lazy-Loaded Galleries) ---
  async function runAutoScrollCollect(minSize = 120, maxSteps = 22): Promise<void> {
    if (autoScrollRunning) return;
    autoScrollRunning = true;

    const collectedMap = new Map<string, PageImageItem>();
    let step = 0;
    let stuckCount = 0;
    let lastScrollY = -1;

    try {
      while (autoScrollRunning && step < maxSteps) {
        const batch = await scanAllPageImages(minSize);
        for (const item of batch) {
          if (!collectedMap.has(item.bestSrc)) {
            collectedMap.set(item.bestSrc, item);
          }
        }

        step++;
        chrome.runtime
          .sendMessage({
            type: 'AUTO_SCROLL_PROGRESS',
            step,
            foundCount: collectedMap.size,
            done: false,
          } satisfies RuntimeMessage)
          .catch(() => {});

        const scrollStep = Math.max(520, Math.round(window.innerHeight * 0.85));
        window.scrollBy({ top: scrollStep, behavior: 'smooth' });
        await new Promise((r) => setTimeout(r, 850));

        const curY = Math.round(window.scrollY);
        if (Math.abs(curY - lastScrollY) < 12) {
          stuckCount++;
          if (stuckCount >= 2) break;
        } else {
          stuckCount = 0;
        }
        lastScrollY = curY;
      }

      // Final scan at stop point
      const finalBatch = await scanAllPageImages(minSize);
      for (const item of finalBatch) {
        if (!collectedMap.has(item.bestSrc)) {
          collectedMap.set(item.bestSrc, item);
        }
      }
    } finally {
      autoScrollRunning = false;
      const images = Array.from(collectedMap.values()).sort(
        (a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight
      );
      chrome.runtime
        .sendMessage({
          type: 'AUTO_SCROLL_PROGRESS',
          step,
          foundCount: images.length,
          done: true,
          images,
        } satisfies RuntimeMessage)
        .catch(() => {});
    }
  }

  function renderToast(msg: Extract<RuntimeMessage, { type: 'CONTENT_TOAST' }>): void {
    ensureShadowUI();
    if (!toastStackEl) return;

    const el = document.createElement('div');
    el.className = `lumina-toast ${msg.status === 'success' ? 'success' : msg.status === 'error' ? 'error' : ''}`;
    const titleEl = document.createElement('div');
    titleEl.className = 'lumina-toast-title';
    titleEl.textContent = msg.title;
    el.appendChild(titleEl);

    if (msg.subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'lumina-toast-sub';
      subEl.textContent = msg.subtitle;
      el.appendChild(subEl);
    }

    toastStackEl.appendChild(el);
    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      window.setTimeout(() => el.remove(), 240);
    }, 3200);
  }

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'SCAN_PAGE_IMAGES') {
      (async () => {
        const images = await scanAllPageImages(message.minSize ?? 64);
        sendResponse({ ok: true, images });
      })();
      return true;
    }

    if (message.type === 'CONTENT_FETCH_IMAGE') {
      (async () => {
        const dataUrl = await fetchImageInPageContext(message.url);
        sendResponse({ ok: Boolean(dataUrl), dataUrl: dataUrl ?? undefined });
      })();
      return true;
    }

    if (message.type === 'TOGGLE_PICKER') {
      const next = typeof message.active === 'boolean' ? message.active : !pickerActive;
      setPickerActive(next);
      sendResponse({ ok: true, active: pickerActive });
      return false;
    }

    if (message.type === 'AUTO_SCROLL_START') {
      void runAutoScrollCollect(message.minSize ?? 120, message.maxSteps ?? 22);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'AUTO_SCROLL_STOP') {
      autoScrollRunning = false;
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'CONTENT_TOAST') {
      renderToast(message);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'SETTINGS_UPDATED') {
      settings = message.settings;
      if (!isHoverEnabledHere()) hideHoverPill();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // Sync local basket membership & settings
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['lumina_bulk_basket_v2']) {
      const list = (changes['lumina_bulk_basket_v2'].newValue as BasketImageItem[] | undefined) ?? [];
      basketSrcSet = new Set(list.map((i) => i.bestSrc));
      if (currentHoverTarget) updateHoverAddButtonState(currentHoverTarget.item.bestSrc);
    }
  });

  void (async () => {
    try {
      const [s, b] = await Promise.all([getSettings(), getBasket()]);
      settings = s;
      basketSrcSet = new Set(b.map((i) => i.bestSrc));
    } catch {
      // ignore if extension context invalidated
    }
  })();
}
