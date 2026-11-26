import { zipSync } from 'fflate';
import {
  buildBatchArchiveName,
  buildFolderPrefix,
  buildImageFilename,
} from './filename';
import { RuntimeMessage } from './messages';
import { addExportHistory } from './storage';
import { BasketImageItem, ExportMode } from './types';

export interface BulkExportProgress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  totalBytes: number;
  stage: 'fetching' | 'packing' | 'downloading' | 'done';
  message: string;
}

export interface BulkExportResult {
  filename: string;
  mode: ExportMode;
  totalRequested: number;
  succeeded: number;
  failed: number;
  totalBytes: number;
  elapsedMs: number;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Data URL inválida.');
  }
  const header = dataUrl.slice(0, commaIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mimeType };
}

async function fetchItemBytes(
  item: BasketImageItem
): Promise<{ bytes: Uint8Array; mimeType: string; resolvedUrl: string }> {
  if (item.inlineDataUrl) {
    const parsed = dataUrlToBytes(item.inlineDataUrl);
    return { ...parsed, resolvedUrl: item.bestSrc };
  }

  const resp = (await chrome.runtime.sendMessage({
    type: 'FETCH_IMAGE_DATA_URL',
    url: item.bestSrc,
    tabId: item.tabId,
  } satisfies RuntimeMessage)) as {
    ok: boolean;
    dataUrl?: string;
    resolvedUrl?: string;
    error?: string;
  };

  if (!resp || !resp.ok || !resp.dataUrl) {
    throw new Error(resp?.error || 'Falha ao baixar imagem.');
  }
  const parsed = dataUrlToBytes(resp.dataUrl);
  return { ...parsed, resolvedUrl: resp.resolvedUrl || item.bestSrc };
}

/**
 * Fetches all selected images in high-speed parallel batches (concurrency = 6)
 * and exports them as either:
 *   - 1 single clean .ZIP archive (zero multiple-download prompts!) via fflate store mode
 *   - OR an organized subfolder directly in Chrome's Downloads folder
 */
export async function runBulkExport(params: {
  items: BasketImageItem[];
  mode: ExportMode;
  label: string;
  includeManifestInZip?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: BulkExportProgress) => void;
}): Promise<BulkExportResult> {
  const startedAt = performance.now();
  const { items, mode, label, includeManifestInZip = false, signal, onProgress } = params;

  if (items.length === 0) {
    throw new Error('Nenhuma foto selecionada para exportar.');
  }

  const total = items.length;
  const usedNames = new Set<string>();
  const zipFiles: Record<string, Uint8Array> = {};
  const manifestEntries: Array<Record<string, unknown>> = [];
  const folderPrefix = buildFolderPrefix(label);

  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let totalBytes = 0;

  const emit = (stage: BulkExportProgress['stage'], message: string) => {
    onProgress?.({ completed, total, succeeded, failed, totalBytes, stage, message });
  };

  emit('fetching', `Baixando 0 de ${total} fotos em resolução original...`);

  // Worker pool of 6 concurrent fetches for blazing-fast bulk export!
  const CONCURRENCY = 6;
  let cursor = 0;

  const worker = async () => {
    while (cursor < total) {
      if (signal?.aborted) return;
      const idx = cursor++;
      const item = items[idx];

      try {
        const { bytes, mimeType, resolvedUrl } = await fetchItemBytes(item);
        if (signal?.aborted) return;

        const filename = buildImageFilename({
          index: idx,
          srcUrl: resolvedUrl,
          alt: item.alt,
          siteHost: item.siteHost,
          mimeType,
          usedNames,
        });

        totalBytes += bytes.byteLength;
        succeeded++;

        if (mode === 'zip') {
          zipFiles[filename] = bytes;
          if (includeManifestInZip) {
            manifestEntries.push({
              file: filename,
              sourceUrl: resolvedUrl,
              originalDomUrl: item.src,
              pageUrl: item.pageUrl,
              pageTitle: item.pageTitle,
              alt: item.alt,
              detectedWidth: item.naturalWidth,
              detectedHeight: item.naturalHeight,
              bytes: bytes.byteLength,
            });
          }
        } else {
          // Direct folder download via same-origin Blob URL
          const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          await chrome.runtime.sendMessage({
            type: 'DOWNLOAD_URL',
            url: blobUrl,
            filename: `${folderPrefix}/${filename}`,
            saveAs: false,
          } satisfies RuntimeMessage);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        }
      } catch {
        failed++;
      } finally {
        completed++;
        emit('fetching', `Baixando ${completed} de ${total} fotos (${succeeded} ok)...`);
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);

  if (signal?.aborted) {
    throw new DOMException('Exportação cancelada pelo usuário.', 'AbortError');
  }

  if (succeeded === 0) {
    throw new Error('Nenhuma das fotos pôde ser baixada (bloqueio de rede ou URLs expiradas).');
  }

  let outputName: string;

  if (mode === 'zip') {
    if (includeManifestInZip) {
      const jsonStr = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          count: succeeded,
          images: manifestEntries,
        },
        null,
        2
      );
      zipFiles['metadata.json'] = new TextEncoder().encode(jsonStr);
    }

    emit('packing', `Empacotando ${succeeded} foto(s) em arquivo ZIP...`);
    // level: 0 (store) = instant packing (zero wasted CPU recompressing JPEG/PNG/WebP!)
    const zipped = zipSync(zipFiles, { level: 0 });
    const zipBlob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
    const zipUrl = URL.createObjectURL(zipBlob);
    outputName = buildBatchArchiveName(label, succeeded);

    emit('downloading', `Salvando ${outputName}...`);
    const dlRes = (await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_URL',
      url: zipUrl,
      filename: outputName,
      saveAs: false,
    } satisfies RuntimeMessage)) as { ok: boolean; error?: string };

    setTimeout(() => URL.revokeObjectURL(zipUrl), 60_000);
    if (!dlRes?.ok) {
      throw new Error(dlRes?.error || 'Falha ao salvar o arquivo ZIP.');
    }
    totalBytes = zipBlob.size;
  } else {
    outputName = `${folderPrefix}/ (${succeeded} arquivos)`;
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  await addExportHistory({
    id: `exp-${Date.now()}`,
    filename: outputName,
    mode,
    totalRequested: total,
    succeeded,
    failed,
    totalBytes,
    timestamp: Date.now(),
  });

  emit('done', `Exportação concluída: ${succeeded} foto(s)!`);

  return {
    filename: outputName,
    mode,
    totalRequested: total,
    succeeded,
    failed,
    totalBytes,
    elapsedMs,
  };
}
