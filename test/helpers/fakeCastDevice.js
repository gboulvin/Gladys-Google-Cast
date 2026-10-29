// -----------------------------------------------------------------------------
// An in-memory Cast device, for the tests: it plays the device side of the
// Cast v2 protocol over a fake socket (no network, no TLS). Pass
// `device.socketFactory` to a CastClient.
//
// It answers like a real receiver: RECEIVER_STATUS on GET_STATUS / LAUNCH /
// SET_VOLUME / STOP, MEDIA_STATUS on the media requests, PONG on PING. The
// tests drive the rest through `device.setMedia`, `device.pushMediaStatus`...
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import {
  DEFAULT_MEDIA_RECEIVER_APP_ID,
  FrameReader,
  NAMESPACES,
  RECEIVER_ID,
  SENDER_ID,
  decodeMessage,
  encodeMessage,
  parsePayload,
} from '../../src/cast/protocol.js';

class FakeSocket extends EventEmitter {
  constructor(device) {
    super();
    this.device = device;
    this.reader = new FrameReader();
    this.destroyed = false;
  }

  write(bytes) {
    if (this.destroyed) {
      throw new Error('write after destroy');
    }
    for (const body of this.reader.push(bytes)) {
      const message = decodeMessage(body);
      this.device.handle(this, message, parsePayload(message));
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    setImmediate(() => this.emit('close'));
  }

  // Device -> client.
  deliver(sourceId, namespace, data) {
    if (this.destroyed) return;
    const bytes = encodeMessage({ sourceId, destinationId: SENDER_ID, namespace, data });
    // Split in two chunks: the client must reassemble the frames.
    const middle = Math.floor(bytes.length / 2);
    this.emit('data', bytes.subarray(0, middle));
    this.emit('data', bytes.subarray(middle));
  }
}

export class FakeCastDevice {
  constructor({ volume = 0.4, muted = false, app = null, reachable = true } = {}) {
    this.volume = volume;
    this.muted = muted;
    this.app = app;
    this.media = null;
    this.reachable = reachable;
    this.received = [];
    this.sockets = [];
    this.nextSession = 1;
    this.nextMediaSession = 100;
    this.socketFactory = () => this.open();
  }

  open() {
    const socket = new FakeSocket(this);
    this.sockets.push(socket);
    setImmediate(() => {
      if (this.reachable) {
        socket.emit('secureConnect');
      } else {
        socket.emit('error', new Error('connect ECONNREFUSED'));
      }
    });
    return socket;
  }

  get socket() {
    return this.sockets.at(-1);
  }

  /** Messages received on a namespace, payload only. */
  requests(namespace, type) {
    return this.received
      .filter((m) => m.namespace === namespace && (!type || m.data?.type === type))
      .map((m) => m.data);
  }

  receiverStatus() {
    return {
      volume: { level: this.volume, muted: this.muted },
      applications: this.app ? [this.app] : [],
    };
  }

  makeApp(appId, displayName = appId, { idle = false } = {}) {
    const session = this.nextSession++;
    return {
      appId,
      displayName,
      sessionId: `session-${session}`,
      transportId: `transport-${session}`,
      statusText: displayName,
      isIdleScreen: idle,
      namespaces: idle ? [] : [{ name: NAMESPACES.MEDIA }],
    };
  }

  mediaStatus() {
    return this.media ? [{ ...this.media }] : [];
  }

  handle(socket, message, data) {
    this.received.push({ namespace: message.namespace, destination: message.destinationId, data });
    if (!data) return;
    const reply = (namespace, payload) =>
      setImmediate(() => socket.deliver(message.destinationId, namespace, payload));
    const requestId = data.requestId;
    if (message.namespace === NAMESPACES.HEARTBEAT && data.type === 'PING') {
      reply(NAMESPACES.HEARTBEAT, { type: 'PONG' });
      return;
    }
    if (message.namespace === NAMESPACES.RECEIVER) {
      switch (data.type) {
        case 'GET_STATUS':
          break;
        case 'SET_VOLUME':
          if (typeof data.volume.level === 'number') this.volume = data.volume.level;
          if (typeof data.volume.muted === 'boolean') this.muted = data.volume.muted;
          break;
        case 'LAUNCH':
          if (data.appId === 'BADAPP') {
            reply(NAMESPACES.RECEIVER, { type: 'LAUNCH_ERROR', requestId, reason: 'NOT_FOUND' });
            return;
          }
          this.app = this.makeApp(
            data.appId,
            data.appId === DEFAULT_MEDIA_RECEIVER_APP_ID ? 'Default Media Receiver' : data.appId,
          );
          this.media = null;
          break;
        case 'STOP':
          this.app = null;
          this.media = null;
          break;
        default:
          return;
      }
      reply(NAMESPACES.RECEIVER, {
        type: 'RECEIVER_STATUS',
        requestId,
        status: this.receiverStatus(),
      });
      return;
    }
    if (message.namespace === NAMESPACES.MEDIA && message.destinationId === this.app?.transportId) {
      switch (data.type) {
        case 'GET_STATUS':
          break;
        case 'LOAD':
          if (data.media.contentId.includes('broken')) {
            reply(NAMESPACES.MEDIA, { type: 'LOAD_FAILED', requestId });
            return;
          }
          this.media = {
            mediaSessionId: this.nextMediaSession++,
            playerState: 'PLAYING',
            currentTime: 0,
            media: { ...data.media, duration: 12 },
          };
          break;
        case 'PLAY':
          this.media.playerState = 'PLAYING';
          break;
        case 'PAUSE':
          this.media.playerState = 'PAUSED';
          break;
        case 'SEEK':
          this.media.currentTime = data.currentTime;
          break;
        case 'STOP':
          this.media = { ...this.media, playerState: 'IDLE', idleReason: 'CANCELLED' };
          break;
        case 'QUEUE_UPDATE':
          break;
        default:
          return;
      }
      reply(NAMESPACES.MEDIA, { type: 'MEDIA_STATUS', requestId, status: this.mediaStatus() });
    }
  }

  // --- Test drivers: the device changes on its own --------------------------

  /** Broadcast the receiver status (requestId 0, like a real device). */
  pushReceiverStatus() {
    this.socket.deliver(RECEIVER_ID, NAMESPACES.RECEIVER, {
      type: 'RECEIVER_STATUS',
      requestId: 0,
      status: this.receiverStatus(),
    });
  }

  /** Broadcast the media status of the running app. */
  pushMediaStatus() {
    this.socket.deliver(this.app.transportId, NAMESPACES.MEDIA, {
      type: 'MEDIA_STATUS',
      requestId: 0,
      status: this.mediaStatus(),
    });
  }

  /** Someone casts from their phone. */
  startApp(appId, displayName, media) {
    this.app = this.makeApp(appId, displayName);
    this.media = media ? { mediaSessionId: this.nextMediaSession++, ...media } : null;
    this.pushReceiverStatus();
  }

  /** The device says PING, the client must answer PONG. */
  ping() {
    this.socket.deliver(RECEIVER_ID, NAMESPACES.HEARTBEAT, { type: 'PING' });
  }

  /** Power cut. */
  disconnect() {
    this.socket.destroy();
  }
}

/** Resolve after the pending setImmediate callbacks (several rounds). */
export async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export { SENDER_ID };
