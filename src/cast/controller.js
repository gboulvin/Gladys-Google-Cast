// -----------------------------------------------------------------------------
// One Cast device, kept connected.
//
// The controller holds a persistent CastClient to the device, reconnects with
// a backoff when it drops, follows the RECEIVER_STATUS (volume, running app)
// and the MEDIA_STATUS of the app (what plays), and turns the Gladys commands
// into Cast requests. Everything the device reports is pushed: no polling.
//
// Events:
//   - 'update' (snapshot, previous) — the device state changed;
//   - 'connect-failed' (failures) — a (re)connection attempt failed, with the
//     number of consecutive failures (the manager refreshes the address).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { CastClient, DEFAULT_CAST_PORT } from './client.js';
import { DEFAULT_MEDIA_RECEIVER_APP_ID, NAMESPACES, RECEIVER_ID } from './protocol.js';
import { buildMediaInfo, readMetadata } from './media.js';

const DEFAULT_RECONNECT_DELAYS_MS = [5_000, 10_000, 30_000, 60_000];

// A notification longer than this is not waited for: the volume is restored.
const NOTIFICATION_MAX_DURATION_MS = 10 * 60 * 1000;

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value))));

function readApplication(application) {
  if (!application) {
    return null;
  }
  return {
    appId: application.appId ?? '',
    name: application.displayName ?? '',
    sessionId: application.sessionId ?? '',
    transportId: application.transportId ?? '',
    statusText: application.statusText ?? '',
    // The "ambient" backdrop of a Chromecast is an app too, but nothing runs.
    isIdleScreen: application.isIdleScreen === true,
    hasMedia: (application.namespaces ?? []).some((ns) => ns?.name === NAMESPACES.MEDIA),
  };
}

export class CastController extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id the Cast id of the device
   * @param {string} options.name
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {Function} [options.clientFactory] `({ host, port }) => CastClient`
   * @param {number[]} [options.reconnectDelaysMs]
   */
  constructor({
    id,
    name,
    host,
    port = DEFAULT_CAST_PORT,
    clientFactory = (options) => new CastClient(options),
    reconnectDelaysMs = DEFAULT_RECONNECT_DELAYS_MS,
  }) {
    super();
    this.id = id;
    this.name = name;
    this.host = host;
    this.port = port;
    this.clientFactory = clientFactory;
    this.reconnectDelaysMs = reconnectDelaysMs;
    this.logger = createLogger({ name: `cast:${name}` });
    this.client = null;
    this.connecting = null;
    this.running = false;
    this.failures = 0;
    this.reconnectTimer = null;
    this.online = false;
    this.volume = null;
    this.muted = null;
    this.app = null;
    this.media = null;
    // What the integration itself started: the manager fires no scene event
    // for it (a scene reacting to its own action would loop).
    this.ownMediaSessions = new Set();
    this.loadingOwnMedia = false;
    this.ownLaunch = null;
  }

  /** Was this media session loaded by the integration? */
  isOwnMedia(mediaSessionId) {
    return mediaSessionId !== null && this.ownMediaSessions.has(mediaSessionId);
  }

  /** Was this app launched by the integration, in the last seconds? */
  isOwnLaunch(appId) {
    return this.ownLaunch?.appId === appId && Date.now() < this.ownLaunch.until;
  }

  /** The state of the device, as a plain object. */
  snapshot() {
    return {
      id: this.id,
      name: this.name,
      online: this.online,
      volume: this.volume,
      muted: this.muted,
      app: this.app ? { ...this.app } : null,
      media: this.media ? { ...this.media } : null,
    };
  }

  /** Keep the device connected, until stop(). */
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.connectNow().catch(() => this.scheduleReconnect());
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    client?.close();
    this.setOffline();
  }

  /**
   * The device moved (DHCP lease, new discovery): reconnect to the new
   * address right away.
   */
  setAddress(host, port = DEFAULT_CAST_PORT) {
    if (host === this.host && port === this.port) {
      return;
    }
    this.logger.info(`New address ${host}:${port} (was ${this.host}:${this.port})`);
    this.host = host;
    this.port = port;
    const client = this.client;
    this.client = null;
    client?.close();
    if (this.running) {
      clearTimeout(this.reconnectTimer);
      this.failures = 0;
      this.connectNow().catch(() => this.scheduleReconnect());
    }
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer) {
      return;
    }
    const delay =
      this.reconnectDelaysMs[Math.min(this.failures, this.reconnectDelaysMs.length - 1)];
    this.failures += 1;
    this.emit('connect-failed', this.failures);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectNow().catch(() => this.scheduleReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /**
   * Connect now, or join the attempt in progress.
   * @returns {Promise<CastClient>}
   */
  connectNow() {
    if (this.client) {
      return Promise.resolve(this.client);
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = (async () => {
      const client = this.clientFactory({ host: this.host, port: this.port });
      client.on('message', (message) => this.handleMessage(client, message));
      client.on('close', (err) => this.handleClose(client, err));
      try {
        await client.connect();
      } catch (err) {
        this.logger.debug(`Connection to ${this.host}:${this.port} failed: ${err.message}`);
        throw err;
      }
      this.client = client;
      this.failures = 0;
      this.logger.info(`Connected to ${this.host}:${this.port}`);
      this.update(() => {
        this.online = true;
      });
      await client.request(RECEIVER_ID, NAMESPACES.RECEIVER, { type: 'GET_STATUS' });
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /**
   * The client to send a command through, connecting first if needed. A
   * command never waits for the backoff: the user is waiting.
   */
  async ensureConnected() {
    try {
      return await this.connectNow();
    } catch (err) {
      throw new Error(`${this.name} is unreachable (${err.message})`, { cause: err });
    }
  }

  handleClose(client, err) {
    if (client !== this.client) {
      return;
    }
    this.client = null;
    this.logger.warn(`Disconnected: ${err?.message ?? 'closed'}`);
    this.setOffline();
    this.scheduleReconnect();
  }

  setOffline() {
    if (!this.online && this.app === null && this.media === null) {
      return;
    }
    this.update(() => {
      this.online = false;
      this.app = null;
      this.media = null;
    });
  }

  /** Apply a mutation and emit 'update' when the snapshot changed. */
  update(mutate) {
    const previous = this.snapshot();
    mutate();
    const next = this.snapshot();
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      this.emit('update', next, previous);
    }
  }

  handleMessage(client, { sourceId, namespace, data }) {
    if (namespace === NAMESPACES.RECEIVER && data.type === 'RECEIVER_STATUS') {
      this.handleReceiverStatus(client, data.status ?? {});
    } else if (namespace === NAMESPACES.MEDIA && data.type === 'MEDIA_STATUS') {
      // Only the app currently running speaks for the media.
      if (this.app && sourceId === this.app.transportId) {
        this.handleMediaStatus(data.status ?? []);
      }
    }
  }

  handleReceiverStatus(client, status) {
    const application = readApplication(status.applications?.[0]);
    const previousSession = this.app?.sessionId;
    this.update(() => {
      if (status.volume) {
        if (typeof status.volume.level === 'number') {
          this.volume = clampPercent(status.volume.level * 100);
        }
        if (typeof status.volume.muted === 'boolean') {
          this.muted = status.volume.muted;
        }
      }
      this.app = application;
      if (!application || application.sessionId !== previousSession) {
        this.media = null;
      }
    });
    // A new app able to play media: follow its media channel.
    if (
      application?.hasMedia &&
      application.transportId &&
      application.sessionId !== previousSession
    ) {
      try {
        client.connectTo(application.transportId);
        client
          .request(application.transportId, NAMESPACES.MEDIA, { type: 'GET_STATUS' })
          .catch((err) => this.logger.debug(`Media status unavailable: ${err.message}`));
      } catch (err) {
        this.logger.debug(`Media channel unavailable: ${err.message}`);
      }
    }
  }

  handleMediaStatus(statuses) {
    const entry = statuses[0];
    if (this.loadingOwnMedia && typeof entry?.mediaSessionId === 'number') {
      this.ownMediaSessions.add(entry.mediaSessionId);
      // Bounded: only the recent sessions matter.
      if (this.ownMediaSessions.size > 20) {
        this.ownMediaSessions.delete(this.ownMediaSessions.values().next().value);
      }
    }
    this.update(() => {
      if (!entry) {
        // Nothing loaded any more. A session that just ended keeps its idle
        // reason, so the stop is still told apart from a never-started one.
        this.media = this.media ? { ...this.media, playerState: 'IDLE' } : null;
        return;
      }
      const sameSession = this.media?.mediaSessionId === entry.mediaSessionId;
      const previous = sameSession ? this.media : null;
      // `media` is only sent when it changed: keep what we know otherwise.
      const metadata = entry.media ? readMetadata(entry.media.metadata) : null;
      this.media = {
        mediaSessionId: entry.mediaSessionId ?? null,
        playerState: entry.playerState ?? 'IDLE',
        idleReason: entry.idleReason ?? null,
        currentTime: typeof entry.currentTime === 'number' ? entry.currentTime : 0,
        duration:
          typeof entry.media?.duration === 'number' && entry.media.duration > 0
            ? entry.media.duration
            : (previous?.duration ?? 0),
        contentId: entry.media?.contentId ?? previous?.contentId ?? '',
        title: metadata ? metadata.title : (previous?.title ?? ''),
        artist: metadata ? metadata.artist : (previous?.artist ?? ''),
        album: metadata ? metadata.album : (previous?.album ?? ''),
        artworkUrl: metadata ? metadata.artworkUrl : (previous?.artworkUrl ?? null),
      };
    });
  }

  // --- Commands --------------------------------------------------------------

  async receiverRequest(data) {
    const client = await this.ensureConnected();
    return client.request(RECEIVER_ID, NAMESPACES.RECEIVER, data);
  }

  async mediaRequest(type, extra = {}) {
    const client = await this.ensureConnected();
    if (!this.app?.transportId || !this.media?.mediaSessionId) {
      throw new Error(`Nothing is playing on ${this.name}`);
    }
    client.connectTo(this.app.transportId);
    return client.request(this.app.transportId, NAMESPACES.MEDIA, {
      type,
      mediaSessionId: this.media.mediaSessionId,
      ...extra,
    });
  }

  /** @param {number} percent 0-100 */
  setVolume(percent) {
    return this.receiverRequest({
      type: 'SET_VOLUME',
      volume: { level: clampPercent(percent) / 100 },
    });
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    return this.receiverRequest({ type: 'SET_VOLUME', volume: { muted } });
  }

  play() {
    return this.mediaRequest('PLAY');
  }

  pause() {
    return this.mediaRequest('PAUSE');
  }

  stopMedia() {
    return this.mediaRequest('STOP');
  }

  /** @param {number} seconds */
  seek(seconds) {
    return this.mediaRequest('SEEK', { currentTime: Math.max(0, Number(seconds)) });
  }

  next() {
    return this.mediaRequest('QUEUE_UPDATE', { jump: 1 });
  }

  previous() {
    return this.mediaRequest('QUEUE_UPDATE', { jump: -1 });
  }

  /**
   * Quit the app casting to the device (back to its idle screen).
   * @returns {Promise<boolean>} false when nothing was casting
   */
  async stopApp() {
    await this.ensureConnected();
    if (!this.app || this.app.isIdleScreen) {
      return false;
    }
    await this.receiverRequest({ type: 'STOP', sessionId: this.app.sessionId });
    return true;
  }

  /**
   * Launch a Cast app by its id (e.g. 233637DE for YouTube).
   * @param {string} appId
   * @returns {Promise<object>} the running app
   */
  async launchApp(appId) {
    this.ownLaunch = { appId, until: Date.now() + 15_000 };
    const response = await this.receiverRequest({ type: 'LAUNCH', appId });
    const application = readApplication(
      response.status?.applications?.find((candidate) => candidate.appId === appId),
    );
    if (!application) {
      throw new Error(`${this.name} did not start the app ${appId}`);
    }
    return application;
  }

  /**
   * Play a URL through the Default Media Receiver.
   * @param {{ url: string, contentType?: string, title?: string, live?: boolean }} options
   * @returns {Promise<number | null>} the media session id
   */
  async loadMedia(options) {
    const client = await this.ensureConnected();
    let application = this.app;
    if (application?.appId !== DEFAULT_MEDIA_RECEIVER_APP_ID || !application.transportId) {
      application = await this.launchApp(DEFAULT_MEDIA_RECEIVER_APP_ID);
    }
    client.connectTo(application.transportId);
    this.loadingOwnMedia = true;
    try {
      const response = await client.request(application.transportId, NAMESPACES.MEDIA, {
        type: 'LOAD',
        media: buildMediaInfo(options),
        autoplay: true,
        currentTime: 0,
      });
      return response.status?.[0]?.mediaSessionId ?? null;
    } finally {
      this.loadingOwnMedia = false;
    }
  }

  /**
   * Play a short clip (a text-to-speech announcement, a chime), at `volume`
   * when given, then put the previous volume back once it ends. Resolves as
   * soon as the device accepted the clip: the restore runs in the background.
   * @param {string} url
   * @param {{ volume?: number, title?: string }} [options]
   */
  async playNotification(url, { volume, title } = {}) {
    await this.ensureConnected();
    const previousVolume = this.volume;
    const target = Number.isFinite(volume) && volume > 0 ? clampPercent(volume) : null;
    const restore = target !== null && previousVolume !== null && target !== previousVolume;
    if (restore) {
      await this.setVolume(target);
    }
    let mediaSessionId;
    try {
      mediaSessionId = await this.loadMedia({ url, title: title ?? 'Gladys Assistant' });
    } catch (err) {
      if (restore) {
        await this.setVolume(previousVolume).catch(() => {});
      }
      throw err;
    }
    if (restore) {
      this.restoreVolumeWhenDone(mediaSessionId, previousVolume);
    }
    return mediaSessionId;
  }

  restoreVolumeWhenDone(mediaSessionId, volume) {
    let timer;
    const done = () => {
      clearTimeout(timer);
      this.off('update', onUpdate);
      this.setVolume(volume).catch((err) =>
        this.logger.warn(`Could not restore the volume: ${err.message}`),
      );
    };
    const onUpdate = (snapshot, previous) => {
      const media = snapshot.media;
      // IDLE also shows up while the clip loads: only an IDLE with a reason,
      // or one following another state, is the end of it.
      const ended =
        media?.playerState === 'IDLE' &&
        (media.idleReason !== null ||
          (previous.media !== null && previous.media.playerState !== 'IDLE'));
      const finished =
        !snapshot.online || !media || media.mediaSessionId !== mediaSessionId || ended;
      if (finished) {
        done();
      }
    };
    timer = setTimeout(done, NOTIFICATION_MAX_DURATION_MS);
    timer.unref?.();
    this.on('update', onUpdate);
  }
}
