/**
 * Smart CDN Thumbnail -> Original Full-Resolution URL Upgrader.
 * Returns candidate higher-resolution URLs to try FIRST before falling back to the DOM URL.
 * Always keeps the original URL as a safe fallback so downloads never break!
 */
export function getUpgradedImageCandidates(rawUrl: string): string[] {
  if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return [rawUrl];
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return [rawUrl];
  }

  const host = parsed.hostname.toLowerCase();
  const candidates: string[] = [];
  const add = (url: string) => {
    if (url && url !== rawUrl && !candidates.includes(url)) {
      candidates.push(url);
    }
  };

  // 1. Twitter / X (pbs.twimg.com) -> name=orig
  if (host === 'pbs.twimg.com' && parsed.pathname.includes('/media/')) {
    const u = new URL(parsed.href);
    u.searchParams.set('name', 'orig');
    add(u.href);
  }

  // 2. Pinterest (i.pinimg.com/236x/... or /474x/... or /564x/... -> /originals/...)
  if (host === 'i.pinimg.com' && /^\/(236x|474x|564x|736x|1200x)\//i.test(parsed.pathname)) {
    const u = new URL(parsed.href);
    u.pathname = u.pathname.replace(/^\/(236x|474x|564x|736x|1200x)\//i, '/originals/');
    add(u.href);
  }

  // 3. Wikimedia Commons thumbnails (/thumb/a/ab/File.jpg/320px-File.jpg -> /a/ab/File.jpg)
  if (host === 'upload.wikimedia.org' && parsed.pathname.includes('/thumb/')) {
    const match = parsed.pathname.match(/^(\/wikipedia\/[^/]+)\/thumb\/(.+)\/[^/]+$/);
    if (match) {
      const u = new URL(parsed.href);
      u.pathname = `${match[1]}/${match[2]}`;
      add(u.href);
    }
  }

  // 4. YouTube thumbnails (hqdefault/mqdefault/sddefault -> maxresdefault)
  if ((host === 'i.ytimg.com' || host === 'img.youtube.com') && /\/(hq|mq|sd)default\.jpg$/i.test(parsed.pathname)) {
    const u = new URL(parsed.href);
    u.pathname = u.pathname.replace(/\/(hq|mq|sd)default\.jpg$/i, '/maxresdefault.jpg');
    add(u.href);
  }

  // 5. Unsplash (images.unsplash.com) -> remove low width cap or raise to 2400 & q=95
  if (host === 'images.unsplash.com' && parsed.searchParams.has('w')) {
    const curW = Number(parsed.searchParams.get('w'));
    if (curW > 0 && curW < 1800) {
      const u = new URL(parsed.href);
      u.searchParams.set('w', '2400');
      u.searchParams.set('q', '95');
      u.searchParams.delete('dpr');
      add(u.href);
    }
  }

  // 6. Amazon product images (._AC_SX300_.jpg / ._SY450_.jpg -> remove resize suffix)
  if (host.includes('media-amazon.com') || host.includes('images-amazon.com')) {
    const stripped = parsed.pathname.replace(/\._[A-Z0-9,_]+_\.(jpg|jpeg|png|webp)$/i, '.$1');
    if (stripped !== parsed.pathname) {
      const u = new URL(parsed.href);
      u.pathname = stripped;
      add(u.href);
    }
  }

  // 7. Shopify CDN (_300x.jpg, _600x600.webp, ?width=400)
  if (host === 'cdn.shopify.com' || parsed.pathname.includes('/cdn/shop/')) {
    const u = new URL(parsed.href);
    let changed = false;
    const newPath = u.pathname.replace(/_(\d+x\d*|\d*x\d+)(_crop_[a-z]+)?\.(jpg|jpeg|png|webp)$/i, '.$3');
    if (newPath !== u.pathname) {
      u.pathname = newPath;
      changed = true;
    }
    if (u.searchParams.has('width') && Number(u.searchParams.get('width')) < 1800) {
      u.searchParams.delete('width');
      changed = true;
    }
    if (changed) add(u.href);
  }

  // 8. WordPress resized thumbnails (photo-300x200.jpg -> photo.jpg)
  if (/\/wp-content\/uploads\/.+-\d{2,4}x\d{2,4}\.(jpg|jpeg|png|webp)$/i.test(parsed.pathname)) {
    const u = new URL(parsed.href);
    u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}\.(jpg|jpeg|png|webp)$/i, '.$1');
    add(u.href);
  }

  // 9. Google Photos / lh3.googleusercontent.com (=w400-h300 or =s400 -> =s0 original)
  if (host.endsWith('googleusercontent.com') && /=([whs]\d+[^/]*)$/i.test(parsed.pathname)) {
    const u = new URL(parsed.href);
    u.pathname = u.pathname.replace(/=([whs]\d+[^/]*)$/i, '=s0');
    add(u.href);
  }

  // 10. Medium CDN (miro.medium.com/v2/resize:fit:600/...)
  if (host === 'miro.medium.com' && /\/resize:fit:\d+\//i.test(parsed.pathname)) {
    const u = new URL(parsed.href);
    u.pathname = u.pathname.replace(/\/resize:fit:\d+\//i, '/resize:fit:2400/');
    add(u.href);
  }

  // Always include the original DOM URL last as guaranteed fallback
  candidates.push(rawUrl);
  return candidates;
}
