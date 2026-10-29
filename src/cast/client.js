// -----------------------------------------------------------------------------
// Low-level Cast v2 client: ONE TLS connection to ONE Cast device.
//
// It owns the virtual connections (CONNECT to the receiver and to the
// transport of the running app), the heartbeat and the request/response
// correlation (`requestId`). It knows nothing about Gladys: the controller
// (src/cast/controller.js) builds the device logic on top of it.
//
// Events:
//   - 'message' ({ sourceId, destinationId, namespace, data }) — every JSON
//     message received, heartbeat excluded;
//   - 'close' (error?) — the connection is gone (emitted once).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import {
  FrameReader,
  NAMESPACES,
  RECEIVER_ID,
  SENDER_ID,
  decodeMessage,
  encodeMessage,
  parsePayload,
} from './protocol.js';

export const DEFAULT_CAST_PORT = 8009;

// Response types that settle a request as failed.
const ERROR_TYPES = new Set([
  'INVALID_REQUEST',
  'LOAD_FAILED',
  'LOAD_CANCELLED',
  'LAUNCH_ERROR',
  'INVALID_PLAYER_STATE',
  'ERROR',
]);

/**
 * Open the TLS socket. Cast devices present a certificate issued by Google's
 * device CA for their own serial, never for an address: like every Cast
 * sender, the client does not check it (see SECURITY.md). The traffic stays
 * on the local network.
 */
function defaultSocketFactory({ host, port }) {
  return tls.connect({ host, port, rejectUnauthorized: false });
}

export class CastClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {Function} [options.socketFactory] `({ host, port }) => Duplex`,
   *   emitting 'secureConnect' (or 'connect'), 'data', 'error', 'close'
   * @param {number} [options.connectTimeoutMs]
   * @param {number} [options.requestTimeoutMs]
   * @param {number} [options.heartbeatIntervalMs]
   */
  constructor({
    host,
    port = DEFAULT_CAST_PORT,
    socketFactory = defaultSocketFactory,
    connectTimeoutMs = 5000,
    requestTimeoutMs = 8000,
    heartbeatIntervalMs = 5000,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.socketFactory = socketFactory;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.socket = null;
    this.closed = false;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.connectedDestinations = new Set();
    this.heartbeatTimer = null;
    this.lastReceivedAt = 0;
  }

  /**
   * Open the connection and the virtual connection to the receiver.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      const reader = new FrameReader();
      let settled = false;
      const socket = this.socketFactory({ host: this.host, port: this.port });
      this.socket = socket;

      const timer = setTimeout(() => {
        fail(new Error(`Connection to ${this.host}:${this.port} timed out`));
      }, this.connectTimeoutMs);

      const fail = (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.close(err);
      };

      const onConnected = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.lastReceivedAt = Date.now();
        this.connectTo(RECEIVER_ID);
        this.startHeartbeat();
        resolve();
      };

      socket.once('secureConnect', onConnected);
      socket.on('data', (chunk) => {
        try {
          for (const body of reader.push(chunk)) {
            this.handleFrame(body);
          }
        } catch (err) {
          fail(err);
        }
      });
      socket.on('error', (err) => fail(err));
      socket.on('close', () => fail(new Error('Connection closed by the device')));
    });
  }

  handleFrame(body) {
    this.lastReceivedAt = Date.now();
    const message = decodeMessage(body);
    const data = parsePayload(message);
    if (data === null) {
      return;
    }
    if (message.namespace === NAMESPACES.HEARTBEAT) {
      if (data.type === 'PING') {
        this.send(message.sourceId, NAMESPACES.HEARTBEAT, { type: 'PONG' });
      }
      return;
    }
    if (message.namespace === NAMESPACES.CONNECTION && data.type === 'CLOSE') {
      // The app behind this transport is gone: a later command must
      // re-open the virtual connection.
      this.connectedDestinations.delete(message.sourceId);
    }
    if (typeof data.requestId === 'number' && data.requestId > 0) {
      const pending = this.pending.get(data.requestId);
      if (pending) {
        this.pending.delete(data.requestId);
        clearTimeout(pending.timer);
        if (ERROR_TYPES.has(data.type)) {
          const reason = data.reason ?? data.detailedErrorCode ?? data.type;
          pending.reject(new Error(`${data.type}: ${reason}`));
        } else {
          pending.resolve(data);
        }
      }
    }
    this.emit('message', {
      sourceId: message.sourceId,
      destinationId: message.destinationId,
      namespace: message.namespace,
      data,
    });
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      // Three missed beats: the device is gone (power cut, Wi-Fi lost)
      // without closing the TCP connection.
      if (Date.now() - this.lastReceivedAt > this.heartbeatIntervalMs * 3) {
        this.close(new Error('Heartbeat timeout'));
        return;
      }
      this.send(RECEIVER_ID, NAMESPACES.HEARTBEAT, { type: 'PING' });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  /**
   * Open the virtual connection to a destination (the receiver, or the
   * transport of a running app), once.
   * @param {string} destinationId
   */
  connectTo(destinationId) {
    if (this.connectedDestinations.has(destinationId)) {
      return;
    }
    this.send(destinationId, NAMESPACES.CONNECTION, {
      type: 'CONNECT',
      origin: {},
      userAgent: 'GladysAssistant',
      senderInfo: { sdkType: 2, version: '15.605.1.3', platform: 4, connectionType: 1 },
    });
    this.connectedDestinations.add(destinationId);
  }

  /**
   * Fire-and-forget message.
   */
  send(destinationId, namespace, data) {
    if (this.closed || !this.socket) {
      throw new Error('Not connected');
    }
    this.socket.write(encodeMessage({ sourceId: SENDER_ID, destinationId, namespace, data }));
  }

  /**
   * Send a message carrying a fresh `requestId` and resolve with the
   * response holding the same one.
   * @returns {Promise<object>}
   */
  request(destinationId, namespace, data) {
    if (this.closed) {
      return Promise.reject(new Error('Not connected'));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`No answer to ${data.type} within ${this.requestTimeoutMs} ms`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send(destinationId, namespace, { ...data, requestId });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Close the connection; idempotent. Pending requests are rejected.
   * @param {Error} [error] the reason, forwarded to the 'close' listeners
   */
  close(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error ?? new Error('Connection closed'));
    }
    this.pending.clear();
    if (this.socket) {
      try {
        if (!error) {
          this.socket.write(
            encodeMessage({
              sourceId: SENDER_ID,
              destinationId: RECEIVER_ID,
              namespace: NAMESPACES.CONNECTION,
              data: { type: 'CLOSE' },
            }),
          );
        }
      } catch {
        // The socket is already unusable: nothing to say goodbye to.
      }
      this.socket.destroy();
    }
    this.emit('close', error);
  }
}
