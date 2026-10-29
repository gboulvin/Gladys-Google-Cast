// -----------------------------------------------------------------------------
// Device type: GOOGLE CAST device (Chromecast, Nest speaker or display, TV
// with Chromecast built-in, speaker group...).
//
// One Gladys device per Cast device, a music player: the features of the
// `music` category drive the "now playing" card of the dashboard, the volume
// and mute controls, and the core's "play a notification" scene action
// (text-to-speech). Every feature key is its Gladys type, which is the
// external id convention of `gladys.publishNowPlaying`.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

const MUSIC = DEVICE_FEATURE_TYPES.MUSIC;

// External id type of the devices. Forever: never rename it.
export const DEVICE_TYPE = 'cast';

// Device params: the address is kept with the device, so a restart can
// reconnect before any scan.
export const PARAMS = {
  HOST: 'CAST_HOST',
  PORT: 'CAST_PORT',
  MODEL: 'CAST_MODEL',
};

// Longest duration/position published, in seconds (24 h).
const MAX_SECONDS = 86_400;

// [type, read_only, min, max]: the order is the display order in Gladys.
const FEATURES = [
  [MUSIC.PLAYBACK_STATE, false, 0, 3],
  [MUSIC.PLAY, false, 1, 1],
  [MUSIC.PAUSE, false, 1, 1],
  [MUSIC.PREVIOUS, false, 1, 1],
  [MUSIC.NEXT, false, 1, 1],
  [MUSIC.VOLUME, false, 0, 100],
  [MUSIC.MUTE, false, 0, 1],
  [MUSIC.PLAY_NOTIFICATION, false, 1, 1],
  [MUSIC.TITLE, true, 0, 0],
  [MUSIC.ARTIST, true, 0, 0],
  [MUSIC.ALBUM, true, 0, 0],
  [MUSIC.ARTWORK, true, 0, 0],
  [MUSIC.DURATION, true, 0, MAX_SECONDS],
  [MUSIC.POSITION, false, 0, MAX_SECONDS],
];

const FEATURE_NAMES = {
  [MUSIC.PLAYBACK_STATE]: 'Playback state',
  [MUSIC.PLAY]: 'Play',
  [MUSIC.PAUSE]: 'Pause',
  [MUSIC.PREVIOUS]: 'Previous',
  [MUSIC.NEXT]: 'Next',
  [MUSIC.VOLUME]: 'Volume',
  [MUSIC.MUTE]: 'Mute',
  [MUSIC.PLAY_NOTIFICATION]: 'Play notification',
  [MUSIC.TITLE]: 'Title',
  [MUSIC.ARTIST]: 'Artist',
  [MUSIC.ALBUM]: 'Album',
  [MUSIC.ARTWORK]: 'Artwork',
  [MUSIC.DURATION]: 'Duration',
  [MUSIC.POSITION]: 'Position',
};

// The commands, written but never read back as a state.
const BUTTONS = new Set([
  MUSIC.PLAY,
  MUSIC.PAUSE,
  MUSIC.PREVIOUS,
  MUSIC.NEXT,
  MUSIC.PLAY_NOTIFICATION,
]);

/** External ids of a Cast device and of its features. */
export function castIds(gladys, castId) {
  return gladys.externalIds(DEVICE_TYPE, castId);
}

/**
 * The Cast id of a device of this integration, `null` for any other one.
 * @param {object} gladys
 * @param {string} externalId
 */
export function castIdOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const castId = externalId.slice(prefix.length);
  return castId && !castId.includes(':') ? castId : null;
}

/**
 * The feature type behind a feature external id (its last segment).
 * @param {string} featureExternalId
 */
export function featureTypeOf(featureExternalId) {
  return String(featureExternalId).split(':').pop();
}

/**
 * Read a device param.
 * @param {{ params?: Array<{ name: string, value: string }> }} device
 * @param {string} name
 */
export function paramOf(device, name) {
  return device?.params?.find((param) => param.name === name)?.value ?? null;
}

/**
 * The discovery payload of a Cast device.
 * @param {object} gladys
 * @param {import('../cast/discovery.js').CastRecord} record
 */
export function buildCastDevice(gladys, record) {
  const ids = castIds(gladys, record.id);
  return {
    name: record.name,
    external_id: ids.device,
    // Event-driven: the device pushes its state over the Cast connection.
    should_poll: false,
    params: [
      { name: PARAMS.HOST, value: record.host },
      { name: PARAMS.PORT, value: String(record.port) },
      ...(record.model ? [{ name: PARAMS.MODEL, value: record.model }] : []),
    ],
    features: FEATURES.map(([type, readOnly, min, max]) => ({
      name: FEATURE_NAMES[type],
      external_id: ids.feature(type),
      category: DEVICE_FEATURE_CATEGORIES.MUSIC,
      type,
      read_only: readOnly,
      // The device confirms every change it accepts through its status.
      has_feedback: !BUTTONS.has(type) && !readOnly,
      // The core forces it off for the whole music category anyway.
      keep_history: false,
      min,
      max,
    })),
  };
}
