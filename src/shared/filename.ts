export function mimeToExtension(mime: string, fallbackUrl = ''): string {
  const clean = mime.toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/svg+xml': 'svg',
  };
  if (map[clean]) return map[clean];

  const urlExtMatch = fallbackUrl.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  if (urlExtMatch) {
    const ext = urlExtMatch[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'svg'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  }
  return 'jpg';
}

export function sanitizeSlug(raw: string, maxLen = 40): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'image'
  );
}

export function buildImageFilename(params: {
  index?: number;
  srcUrl: string;
  alt?: string;
  siteHost?: string;
  mimeType: string;
  usedNames?: Set<string>;
}): string {
  const { index, srcUrl, alt, siteHost, mimeType, usedNames } = params;
  let base = '';

  if (srcUrl && !srcUrl.startsWith('data:') && !srcUrl.startsWith('blob:') && !srcUrl.startsWith('canvas:')) {
    try {
      const parsed = new URL(srcUrl);
      const lastSeg = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
      base = lastSeg.replace(/\.[a-z0-9]{2,5}$/i, '');
    } catch {
      // ignore invalid URL
    }
  }

  if ((!base || base.length < 2 || /^[0-9a-f_-]{26,}$/i.test(base)) && alt && alt.trim().length > 1) {
    base = alt.trim();
  }

  if (!base || base.length < 2) {
    base = siteHost ? siteHost.replace(/^www\./, '').split('.')[0] : 'photo';
  }

  const prefix = typeof index === 'number' ? `${String(index + 1).padStart(3, '0')}_` : '';
  const slug = sanitizeSlug(base, 42);
  const ext = mimeToExtension(mimeType, srcUrl);

  let candidate = `${prefix}${slug}.${ext}`;
  if (usedNames) {
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${prefix}${slug}_${counter}.${ext}`;
      counter++;
    }
    usedNames.add(candidate.toLowerCase());
  }

  return candidate;
}

export function buildBatchArchiveName(label: string, count: number): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  const safeLabel = sanitizeSlug(label.replace(/^www\./, ''), 28);
  return `Lumina_${safeLabel}_${count}imgs_${stamp}.zip`;
}

export function buildFolderPrefix(label: string): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safeLabel = sanitizeSlug(label.replace(/^www\./, ''), 24);
  return `LuminaExport/${safeLabel}_${dateStr}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
