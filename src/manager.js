// -----------------------------------------------------------------------------
// The Cast manager: the bridge between Gladys and the Cast devices.
//
//   - discovery: mDNS through the core + the addresses typed by the user;
//   - one CastController per device the user CREATED in Gladys (the
//     discovered but not created ones are never connected to);
//   - every state change of a device becomes Gladys states (the "now
//     playing" features), a transport badge (local / unreachable), scene
//     events and a widget refresh;
//   - the Gladys commands (onSetValue) become Cast requests.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_TYPES,
  DEVICE_TRANSPORTS,
  MUSIC_PLAYBACK_STATE,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { CastController } from './cast/controller.js';
import {
  MDNS_SERVICE,
  manualRecord,
  parseManualHosts,
  parseMdnsResults,
} from './cast/discovery.js';
import { assertMediaUrl, toPlaybackState } from './cast/media.js';
import { DEFAULT_CAST_PORT } from './cast/client.js';
import {
  PARAMS,
  buildCastDevice,
  castIdOf,
  castIds,
  featureTypeOf,
  paramOf,
} from './devices/castDevice.js';
import { normalizeConfig } from './config.js';

const MUSIC = DEVICE_FEATURE_TYPES.MUSIC;

const logger = createLogger({ name: 'manager' });

// Scene trigger keys, as declared in the manifest `scene_triggers`. Forever:
// scenes store them.
export const SCENE_TRIGGERS = {
  PLAYBACK_STARTED: 'playback_started',
  PLAYBACK_STOPPED: 'playback_stopped',
  APP_LAUNCHED: 'app_launched',
  AVAILABILITY_CHANGED: 'availability_changed',
};

// How the end of a playback reads in the `reason` filter of playback_stopped.
const STOP_REASONS = {
  FINISHED: 'finished',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
  ERROR: 'error',
};

// A device that keeps failing may have moved: re-browse, at most this often.
const ADDRESS_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const FAILURES_BEFORE_ADDRESS_REFRESH = 2;

// The core rate-limits widget nudges to 1 per 10 s and drops the extra ones:
// coalesce them here so the last change is never the dropped one.
const WIDGET_REFRESH_INTERVAL_MS = 10_500;

const ACTIVE_STATES = new Set(['PLAYING', 'PAUSED', 'BUFFERING']);

const mediaIdentity = (media) => `${media.mediaSessionId}|${media.contentId}|${media.title}`;

export class CastManager {
  /**
   * @param {object} gladys the SDK client
   * @param {object} [options]
   * @param {Function} [options.controllerFactory] `(options) => CastController`
   * @param {Function} [options.onWidgetsChanged] called (throttled) when the
   *   widgets content changed
   */
  constructor(gladys, { controllerFactory, onWidgetsChanged } = {}) {
    this.gladys = gladys;
    this.controllerFactory = controllerFactory ?? ((options) => new CastController(options));
    this.onWidgetsChanged = onWidgetsChanged ?? (() => {});
    this.config = normalizeConfig();
    this.records = new Map();
    this.controllers = new Map();
    this.announcedMedia = new Map();
    this.lastAddressRefresh = 0;
    this.widgetTimer = null;
    this.widgetPending = false;
    this.lastWidgetRefresh = -Infinity;
  }

  setConfig(config) {
    this.config = normalizeConfig(config);
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Browse the network and read the manual addresses. Refreshes the known
   * addresses of the devices already connected.
   * @returns {Promise<{ records: object[], invalid: string[] }>}
   */
  async discover() {
    let found = [];
    try {
      const results = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: this.config.scan_timeout,
      });
      found = parseMdnsResults(results, { includeGroups: this.config.include_groups });
      logger.info(`mDNS (${MDNS_SERVICE}): ${found.length} device(s)`);
    } catch (err) {
      // The manual addresses still work without mDNS.
      logger.warn(`mDNS scan failed: ${err.message}`);
    }
    const { hosts, invalid } = parseManualHosts(this.config.manual_hosts);
    if (invalid.length > 0) {
      logger.warn(`Ignored manual addresses: ${invalid.join(', ')}`);
    }
    const manual = hosts
      .filter(({ host, port }) => !found.some((r) => r.host === host && r.port === port))
      .map(manualRecord);
    const records = [...found, ...manual];
    for (const record of records) {
      this.records.set(record.id, record);
      this.controllers.get(record.id)?.setAddress(record.host, record.port);
    }
    return { records, invalid };
  }

  /**
   * Answer the Discovery tab: browse, then publish every device found.
   */
  async publishDiscovered() {
    const result = await this.discover();
    await this.gladys.publishDiscoveredDevices(
      result.records.map((record) => buildCastDevice(this.gladys, record)),
    );
    return result;
  }

  /**
   * Re-browse when a device keeps failing (its address may have changed),
   * at most every 5 minutes.
   */
  async refreshAddresses() {
    const now = Date.now();
    if (now - this.lastAddressRefresh < ADDRESS_REFRESH_MIN_INTERVAL_MS) {
      return false;
    }
    this.lastAddressRefresh = now;
    await this.discover().catch((err) => logger.warn(`Address refresh failed: ${err.message}`));
    return true;
  }

  // --- Connections -----------------------------------------------------------

  /** The Cast devices created by the user in Gladys. */
  createdDevices() {
    return (this.gladys.devices ?? []).filter((device) =>
      castIdOf(this.gladys, device.external_id),
    );
  }

  /**
   * Connect to the created devices, and only to them: start the new ones,
   * stop the deleted ones, follow the renamed or moved ones.
   */
  syncControllers() {
    const wanted = new Map();
    for (const device of this.createdDevices()) {
      const castId = castIdOf(this.gladys, device.external_id);
      const record = this.records.get(castId);
      const host = record?.host ?? paramOf(device, PARAMS.HOST);
      const port = Number(record?.port ?? paramOf(device, PARAMS.PORT) ?? DEFAULT_CAST_PORT);
      if (!host) {
        logger.warn(`No address known for ${device.name}: run a scan`);
        continue;
      }
      wanted.set(castId, { name: device.name, host, port });
    }

    for (const [castId, controller] of this.controllers) {
      if (!wanted.has(castId)) {
        logger.info(`Stop following ${controller.name}`);
        controller.removeAllListeners();
        controller.stop();
        this.controllers.delete(castId);
        this.announcedMedia.delete(castId);
      }
    }

    for (const [castId, { name, host, port }] of wanted) {
      const existing = this.controllers.get(castId);
      if (existing) {
        existing.name = name;
        existing.setAddress(host, port);
        continue;
      }
      const controller = this.controllerFactory({ id: castId, name, host, port });
      controller.on('update', (snapshot, previous) => {
        this.handleUpdate(castId, snapshot, previous).catch((err) =>
          logger.error(`Publishing the state of ${controller.name} failed`, err),
        );
      });
      controller.on('connect-failed', (failures) => {
        if (failures >= FAILURES_BEFORE_ADDRESS_REFRESH) {
          this.refreshAddresses();
        }
      });
      this.controllers.set(castId, controller);
      controller.start();
    }
    this.requestWidgetRefresh();
  }

  stop() {
    clearTimeout(this.widgetTimer);
    this.widgetTimer = null;
    for (const controller of this.controllers.values()) {
      controller.removeAllListeners();
      controller.stop();
    }
    this.controllers.clear();
    this.announcedMedia.clear();
  }

  /**
   * The controller of a device of this integration.
   * @param {string} externalId device external id
   * @returns {CastController}
   */
  controllerOf(externalId) {
    const castId = castIdOf(this.gladys, externalId);
    const controller = castId ? this.controllers.get(castId) : undefined;
    if (!controller) {
      throw new Error(`Unknown Google Cast device: ${externalId}`);
    }
    return controller;
  }

  /**
   * The created devices with their live state, sorted by name.
   * @returns {Array<{ externalId: string, name: string, snapshot: object | null }>}
   */
  listDevices() {
    return this.createdDevices()
      .map((device) => {
        const castId = castIdOf(this.gladys, device.external_id);
        return {
          externalId: device.external_id,
          name: device.name,
          snapshot: this.controllers.get(castId)?.snapshot() ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Re-publish the transport badge of every followed device. */
  async publishAllTransports() {
    const entries = [...this.controllers.entries()].map(([castId, controller]) =>
      this.transportEntry(castId, controller.online),
    );
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  /**
   * Publish the current state of every followed device again: Gladys drops
   * the states of a device it does not know yet, and the SDK forgets what it
   * sent when a device is created or updated.
   */
  async republishAll() {
    for (const [castId, controller] of this.controllers) {
      await this.gladys.publishNowPlaying(
        castIds(this.gladys, castId).device,
        toNowPlaying(controller.snapshot()),
      );
    }
    await this.publishAllTransports();
  }

  transportEntry(castId, online) {
    return {
      external_id: castIds(this.gladys, castId).device,
      transport: online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
    };
  }

  // --- State publication -----------------------------------------------------

  async handleUpdate(castId, snapshot, previous) {
    const controller = this.controllers.get(castId);
    if (!controller) {
      return;
    }
    const deviceId = castIds(this.gladys, castId).device;
    await this.gladys.publishNowPlaying(deviceId, toNowPlaying(snapshot));
    if (snapshot.online !== previous.online) {
      await this.gladys.publishTransports([this.transportEntry(castId, snapshot.online)]);
    }
    for (const [key, data] of this.detectEvents(castId, controller, snapshot, previous)) {
      await this.gladys.publishSceneEvent(key, { device: deviceId, ...data });
    }
    this.requestWidgetRefresh();
  }

  /**
   * The scene events a state change fires: one per transition, never for
   * what the integration itself started.
   * @returns {Array<[string, object]>}
   */
  detectEvents(castId, controller, snapshot, previous) {
    const events = [];
    if (snapshot.online !== previous.online) {
      events.push([
        SCENE_TRIGGERS.AVAILABILITY_CHANGED,
        { status: snapshot.online ? 'online' : 'offline' },
      ]);
    }

    const app = snapshot.app;
    if (
      app &&
      !app.isIdleScreen &&
      app.sessionId !== previous.app?.sessionId &&
      !controller.isOwnLaunch(app.appId)
    ) {
      events.push([SCENE_TRIGGERS.APP_LAUNCHED, { app: app.name, app_id: app.appId }]);
    }

    const media = snapshot.media;
    const before = previous.media;
    if (media?.playerState === 'PLAYING') {
      const identity = mediaIdentity(media);
      if (this.announcedMedia.get(castId) !== identity) {
        this.announcedMedia.set(castId, identity);
        if (!controller.isOwnMedia(media.mediaSessionId)) {
          events.push([
            SCENE_TRIGGERS.PLAYBACK_STARTED,
            { title: media.title, artist: media.artist, app: app?.name ?? '' },
          ]);
        }
      }
    } else if (!media || media.playerState === 'PAUSED' || media.playerState === 'IDLE') {
      // Paused or stopped: the next PLAYING is a new start (a resume too).
      this.announcedMedia.delete(castId);
    }

    const wasActive = before && ACTIVE_STATES.has(before.playerState);
    const isStopped =
      !media || media.playerState === 'IDLE' || media.mediaSessionId !== before?.mediaSessionId;
    if (wasActive && isStopped && !controller.isOwnMedia(before.mediaSessionId)) {
      events.push([
        SCENE_TRIGGERS.PLAYBACK_STOPPED,
        { reason: stopReason(snapshot, media), title: before.title },
      ]);
    }
    return events;
  }

  // --- Widgets ---------------------------------------------------------------

  /**
   * Ask the dashboards to re-pull the widgets, at most once per 10 s, the
   * last request always honored.
   */
  requestWidgetRefresh() {
    if (this.widgetTimer) {
      this.widgetPending = true;
      return;
    }
    const wait = this.lastWidgetRefresh + WIDGET_REFRESH_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.lastWidgetRefresh = Date.now();
      this.onWidgetsChanged();
      return;
    }
    this.widgetPending = true;
    this.widgetTimer = setTimeout(() => {
      this.widgetTimer = null;
      if (this.widgetPending) {
        this.widgetPending = false;
        this.lastWidgetRefresh = Date.now();
        this.onWidgetsChanged();
      }
    }, wait);
    this.widgetTimer.unref?.();
  }

  // --- Commands --------------------------------------------------------------

  /**
   * Run a Gladys command on a Cast device.
   * @param {object} device
   * @param {object} feature
   * @param {number | string} value
   */
  async setValue(device, feature, value) {
    const controller = this.controllerOf(device.external_id);
    const type = feature.type ?? featureTypeOf(feature.external_id);
    switch (type) {
      case MUSIC.VOLUME:
        return controller.setVolume(Number(value));
      case MUSIC.MUTE:
        return controller.setMuted(Number(value) === 1);
      case MUSIC.PLAY:
        return controller.play();
      case MUSIC.PAUSE:
        return controller.pause();
      case MUSIC.NEXT:
        return controller.next();
      case MUSIC.PREVIOUS:
        return controller.previous();
      case MUSIC.POSITION:
        return controller.seek(Number(value));
      case MUSIC.PLAYBACK_STATE:
        return this.setPlaybackState(controller, Number(value));
      case MUSIC.PLAY_NOTIFICATION:
        // The core sends the URL of the text-to-speech clip it just made.
        return controller.playNotification(assertMediaUrl(value), {
          volume: this.config.notification_volume,
        });
      default:
        throw new Error(`The feature ${type} cannot be controlled`);
    }
  }

  setPlaybackState(controller, state) {
    switch (state) {
      case MUSIC_PLAYBACK_STATE.PLAYING:
        return controller.play();
      case MUSIC_PLAYBACK_STATE.PAUSED:
        return controller.pause();
      case MUSIC_PLAYBACK_STATE.IDLE:
        return controller.stopMedia();
      default:
        throw new Error(`Unsupported playback state: ${state}`);
    }
  }
}

function stopReason(snapshot, media) {
  if (!snapshot.online) {
    return STOP_REASONS.INTERRUPTED;
  }
  if (media?.playerState === 'IDLE' && media.idleReason && STOP_REASONS[media.idleReason]) {
    return STOP_REASONS[media.idleReason];
  }
  if (media && media.playerState !== 'IDLE') {
    // Another media replaced the one that played.
    return STOP_REASONS.INTERRUPTED;
  }
  return STOP_REASONS.CANCELLED;
}

/**
 * The `publishNowPlaying` values of a device snapshot.
 * @param {object} snapshot
 */
export function toNowPlaying(snapshot) {
  const media = snapshot.online ? snapshot.media : null;
  const values = {
    playback_state: toPlaybackState(media?.playerState),
    title: media?.title ?? '',
    artist: media?.artist ?? '',
    album: media?.album ?? '',
    artwork_url: media?.artworkUrl ?? null,
    duration: Math.max(0, media?.duration ?? 0),
    position: Math.max(0, media?.currentTime ?? 0),
  };
  if (snapshot.volume !== null) {
    values.volume = snapshot.volume;
  }
  if (snapshot.muted !== null) {
    values.mute = snapshot.muted;
  }
  return values;
}
