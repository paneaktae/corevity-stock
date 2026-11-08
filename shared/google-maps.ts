/** Extracts only the URL from a pasted Google Maps iframe snippet. The HTML itself is never rendered. */
export function extractGoogleMapsUrl(value: string) {
  const iframeSource = value.match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  return (iframeSource ?? value).trim().replace(/&amp;/gi, '&');
}

export function isSafeGoogleMapsUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (url.hostname === 'www.google.com' || url.hostname === 'maps.google.com')
      return url.pathname.startsWith('/maps/');
    return url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function isGoogleMapsEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.google.com'
      && url.pathname === '/maps/embed' && Boolean(url.searchParams.get('pb'))
      && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}
