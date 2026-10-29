// -----------------------------------------------------------------------------
// Artwork for the `cast_player` widget.
//
// The browser never loads a third-party URL: the widget content declares an
// image KEY (the same `gladys.artworkKey(url)` as the "now playing" card) and
// the core asks the integration for its bytes (`onWidgetGetImage`). The core
// refuses an image over 300 KB and never resizes: a bigger cover is simply
// not shown.
// -----------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 300 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Fetch an artwork and return its raw base64.
 * @param {string | undefined} url the URL recorded by `gladys.artworkKey`
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function fetchArtwork(url, fetchImpl = fetch) {
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error('Unknown artwork');
  }
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Artwork fetch failed: HTTP ${response.status}`);
  }
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type && !IMAGE_TYPES.includes(type)) {
    throw new Error(`Unsupported artwork type: ${type}`);
  }
  const announced = Number(response.headers.get('content-length'));
  if (announced > MAX_IMAGE_BYTES) {
    throw new Error(`Artwork too large: ${announced} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Artwork too large: ${bytes.length} bytes`);
  }
  return bytes.toString('base64');
}
