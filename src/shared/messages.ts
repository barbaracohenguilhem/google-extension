import { BasketImageItem, ExtensionSettings, PageImageItem } from './types';

export type RuntimeMessage =
  // Add one or more images to the persistent multi-site bulk basket
  | {
      type: 'BASKET_ADD';
      items: BasketImageItem[];
      silent?: boolean;
    }
  // Remove image(s) from basket
  | {
      type: 'BASKET_REMOVE';
      bestSrcs: string[];
    }
  // Clear entire basket
  | {
      type: 'BASKET_CLEAR';
    }
  // Broadcast basket count/state change to UI pages
  | {
      type: 'BASKET_UPDATED';
      count: number;
    }
  // Save single original full-res image immediately
  | {
      type: 'SAVE_SINGLE_NOW';
      src: string;
      inlineDataUrl?: string;
      alt?: string;
      siteHost?: string;
      tabId?: number;
    }
  // Fetch any image URL (with CDN full-res upgrader + Referer hotlink fallback) as Data URL
  | {
      type: 'FETCH_IMAGE_DATA_URL';
      url: string;
      tabId?: number;
    }
  // Service Worker -> Content Script: fallback fetch inside page context for hotlink-protected (403) images
  | {
      type: 'CONTENT_FETCH_IMAGE';
      url: string;
    }
  // Trigger Chrome browser download for a blob:/data: URL
  | {
      type: 'DOWNLOAD_URL';
      url: string;
      filename: string;
      saveAs?: boolean;
    }
  // Scan all images on current tab (including Shadow DOM, CSS backgrounds, canvas, video)
  | {
      type: 'SCAN_PAGE_IMAGES';
      minSize?: number;
    }
  // Toggle Universal Multi-Click Collector mode on current tab
  | {
      type: 'TOGGLE_PICKER';
      active?: boolean;
    }
  // Auto-scroll lazy-load page collector controls
  | {
      type: 'AUTO_SCROLL_START';
      minSize?: number;
      maxSteps?: number;
    }
  | {
      type: 'AUTO_SCROLL_STOP';
    }
  | {
      type: 'AUTO_SCROLL_PROGRESS';
      step: number;
      foundCount: number;
      done: boolean;
      images?: PageImageItem[];
    }
  // Show subtle non-blocking toast notification inside active webpage
  | {
      type: 'CONTENT_TOAST';
      toastId: string;
      status: 'info' | 'success' | 'error';
      title: string;
      subtitle?: string;
    }
  // Settings updated broadcast
  | {
      type: 'SETTINGS_UPDATED';
      settings: ExtensionSettings;
    };
