// -----------------------------------------------------------------------------
// Media helpers: what to send in a LOAD request, and how to read the
// MEDIA_STATUS a device answers. Pure functions, no I/O.
// -----------------------------------------------------------------------------

import { MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';

// Extension -> content type, for the URLs whose type the user did not give.
const CONTENT_TYPES_BY_EXTENSION = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m3u8: 'application/x-mpegURL',
  mpd: 'application/dash+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// The content types offered by the `content_type` field of the `cast_media`
// scene action ('auto' guesses from the URL).
export const CONTENT_TYPE_OPTIONS = [
  'auto',
  'audio/mpeg',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'application/x-mpegURL',
  'image/jpeg',
  'image/png',
];

/**
 * Check a media URL: Cast devices only fetch http(s).
 * @param {unknown} url
 * @returns {string} the trimmed URL
 */
export function assertMediaUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('A media URL is required');
  }
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid media URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The media URL must start with http:// or https://');
  }
  return parsed.toString();
}

/**
 * Guess the content type of a media URL from its extension; MP3 when nothing
 * matches (the Gladys text-to-speech clips, most radio streams).
 * @param {string} url
 * @returns {string}
 */
export function guessContentType(url) {
  try {
    const { pathname } = new URL(url);
    const extension = pathname.split('.').pop()?.toLowerCase() ?? '';
    return CONTENT_TYPES_BY_EXTENSION[extension] ?? 'audio/mpeg';
  } catch {
    return 'audio/mpeg';
  }
}

/**
 * Build the `media` object of a LOAD request.
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.contentType] 'auto' or empty = guessed
 * @param {string} [options.title]
 * @param {boolean} [options.live] a live stream (web radio) has no duration
 * @returns {object}
 */
export function buildMediaInfo({ url, contentType, title, live = false }) {
  const type = !contentType || contentType === 'auto' ? guessContentType(url) : contentType;
  return {
    contentId: url,
    contentUrl: url,
    contentType: type,
    streamType: live ? 'LIVE' : 'BUFFERED',
    metadata: {
      // 0 = GenericMediaMetadata: a title only; 3 = MusicTrackMediaMetadata.
      metadataType: 0,
      title: title || 'Gladys Assistant',
      images: [],
    },
  };
}

/**
 * Map a Cast `playerState` to the Gladys MUSIC_PLAYBACK_STATE enum.
 * @param {string | undefined} playerState
 * @returns {number}
 */
export function toPlaybackState(playerState) {
  switch (playerState) {
    case 'PLAYING':
      return MUSIC_PLAYBACK_STATE.PLAYING;
    case 'PAUSED':
      return MUSIC_PLAYBACK_STATE.PAUSED;
    case 'BUFFERING':
    case 'LOADING':
      return MUSIC_PLAYBACK_STATE.BUFFERING;
    default:
      return MUSIC_PLAYBACK_STATE.IDLE;
  }
}

/**
 * Pick the best artwork of a Cast metadata: the first image is the
 * largest one by convention.
 * @param {object | undefined} metadata
 * @returns {string | null}
 */
export function artworkUrlOf(metadata) {
  const url = metadata?.images?.find((image) => typeof image?.url === 'string')?.url;
  return url && /^https?:\/\//.test(url) ? url : null;
}

/**
 * Read the "now playing" part of a media `metadata` object, whatever its
 * metadataType (generic, movie, TV show, music track, photo).
 * @param {object | undefined} metadata
 * @returns {{ title: string, artist: string, album: string, artworkUrl: string | null }}
 */
export function readMetadata(metadata) {
  const text = (value) => (typeof value === 'string' ? value : '');
  return {
    title: text(metadata?.title) || text(metadata?.songName),
    artist:
      text(metadata?.artist) ||
      text(metadata?.albumArtist) ||
      text(metadata?.subtitle) ||
      text(metadata?.seriesTitle) ||
      text(metadata?.studio),
    album: text(metadata?.albumName),
    artworkUrl: artworkUrlOf(metadata),
  };
}
