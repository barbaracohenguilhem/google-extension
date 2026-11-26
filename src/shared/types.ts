export type ExportMode = 'zip' | 'folder';

export type ImageSourceType = 'img' | 'picture' | 'background' | 'canvas' | 'svg' | 'video';

export interface ExtensionSettings {
  exportMode: ExportMode;
  upgradeThumbnailUrls: boolean;
  showHoverButton: boolean;
  minHoverImageSize: number;
  includeManifestInZip: boolean;
  disabledHoverDomains: string[];
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  exportMode: 'zip',
  upgradeThumbnailUrls: true,
  showHoverButton: true,
  minHoverImageSize: 120,
  includeManifestInZip: false,
  disabledHoverDomains: [],
};

export interface PageImageItem {
  id: string;
  src: string;
  bestSrc: string;
  alt: string;
  sourceType: ImageSourceType;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  inlineDataUrl?: string;
}

export interface BasketImageItem extends PageImageItem {
  pageUrl: string;
  pageTitle: string;
  siteHost: string;
  tabId?: number;
  addedAt: number;
}

export interface ExportHistoryEntry {
  id: string;
  filename: string;
  mode: ExportMode;
  totalRequested: number;
  succeeded: number;
  failed: number;
  totalBytes: number;
  timestamp: number;
}
