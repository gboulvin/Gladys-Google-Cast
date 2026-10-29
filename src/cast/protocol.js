// -----------------------------------------------------------------------------
// Google Cast v2 wire format.
//
// A Cast device listens on TCP 8009 (TLS). Every message is a 4-byte
// big-endian length followed by a protobuf `CastMessage`:
//
//   message CastMessage {
//     required ProtocolVersion protocol_version = 1;  // CASTV2_1_0 = 0
//     required string source_id = 2;
//     required string destination_id = 3;
//     required string namespace = 4;
//     required PayloadType payload_type = 5;          // STRING = 0, BINARY = 1
//     optional string payload_utf8 = 6;
//     optional bytes payload_binary = 7;
//   }
//
// Seven fields, two wire types: a hand-written codec is shorter than a
// protobuf dependency and keeps the image to a single runtime dependency (the
// SDK). The JSON payloads of the `urn:x-cast:*` namespaces travel in
// `payload_utf8`.
// -----------------------------------------------------------------------------

export const NAMESPACES = {
  CONNECTION: 'urn:x-cast:com.google.cast.tp.connection',
  HEARTBEAT: 'urn:x-cast:com.google.cast.tp.heartbeat',
  RECEIVER: 'urn:x-cast:com.google.cast.receiver',
  MEDIA: 'urn:x-cast:com.google.cast.media',
};

export const SENDER_ID = 'sender-0';
export const RECEIVER_ID = 'receiver-0';

// The Default Media Receiver: Google's own app, plays any URL it can decode.
export const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

// A Cast message is capped at 64 KiB by the protocol; a larger announced
// length means a broken or hostile peer, never a message to buffer.
export const MAX_FRAME_BYTES = 64 * 1024;

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32BIT = 5;

const FIELDS = {
  PROTOCOL_VERSION: 1,
  SOURCE_ID: 2,
  DESTINATION_ID: 3,
  NAMESPACE: 4,
  PAYLOAD_TYPE: 5,
  PAYLOAD_UTF8: 6,
  PAYLOAD_BINARY: 7,
};

const PAYLOAD_TYPE_STRING = 0;

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function encodeKey(field, wireType) {
  return encodeVarint((field << 3) | wireType);
}

function encodeString(field, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([
    encodeKey(field, WIRE_LENGTH_DELIMITED),
    encodeVarint(bytes.length),
    bytes,
  ]);
}

function encodeEnum(field, value) {
  return Buffer.concat([encodeKey(field, WIRE_VARINT), encodeVarint(value)]);
}

/**
 * Encode a CastMessage carrying a JSON payload, framed (length prefix
 * included): the bytes to write on the socket.
 * @param {{ sourceId?: string, destinationId: string, namespace: string, data: object }} message
 * @returns {Buffer}
 */
export function encodeMessage({ sourceId = SENDER_ID, destinationId, namespace, data }) {
  const body = Buffer.concat([
    encodeEnum(FIELDS.PROTOCOL_VERSION, 0),
    encodeString(FIELDS.SOURCE_ID, sourceId),
    encodeString(FIELDS.DESTINATION_ID, destinationId),
    encodeString(FIELDS.NAMESPACE, namespace),
    encodeEnum(FIELDS.PAYLOAD_TYPE, PAYLOAD_TYPE_STRING),
    encodeString(FIELDS.PAYLOAD_UTF8, JSON.stringify(data)),
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

function decodeVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    if (position >= buffer.length) {
      throw new Error('Truncated varint');
    }
    const byte = buffer[position];
    position += 1;
    // Multiplication, not <<: a 32-bit shift would overflow on the 5th byte.
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value, offset: position };
    }
    shift += 7;
    if (shift > 49) {
      throw new Error('Varint too long');
    }
  }
}

/**
 * Decode the body of a CastMessage (without its length prefix). Unknown
 * fields are skipped, as protobuf requires.
 * @param {Buffer} body
 * @returns {{ protocolVersion: number, sourceId: string, destinationId: string, namespace: string, payloadType: number, payloadUtf8?: string, payloadBinary?: Buffer }}
 */
export function decodeMessage(body) {
  const message = { protocolVersion: 0, sourceId: '', destinationId: '', namespace: '' };
  let offset = 0;
  while (offset < body.length) {
    const key = decodeVarint(body, offset);
    offset = key.offset;
    const field = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (wireType === WIRE_VARINT) {
      const decoded = decodeVarint(body, offset);
      offset = decoded.offset;
      if (field === FIELDS.PROTOCOL_VERSION) message.protocolVersion = decoded.value;
      if (field === FIELDS.PAYLOAD_TYPE) message.payloadType = decoded.value;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = decodeVarint(body, offset);
      offset = length.offset;
      const end = offset + length.value;
      if (end > body.length) {
        throw new Error('Truncated field');
      }
      const bytes = body.subarray(offset, end);
      offset = end;
      if (field === FIELDS.SOURCE_ID) message.sourceId = bytes.toString('utf8');
      if (field === FIELDS.DESTINATION_ID) message.destinationId = bytes.toString('utf8');
      if (field === FIELDS.NAMESPACE) message.namespace = bytes.toString('utf8');
      if (field === FIELDS.PAYLOAD_UTF8) message.payloadUtf8 = bytes.toString('utf8');
      if (field === FIELDS.PAYLOAD_BINARY) message.payloadBinary = Buffer.from(bytes);
    } else if (wireType === WIRE_64BIT) {
      offset += 8;
    } else if (wireType === WIRE_32BIT) {
      offset += 4;
    } else {
      throw new Error(`Unsupported wire type ${wireType}`);
    }
  }
  if (offset > body.length) {
    throw new Error('Truncated message');
  }
  return message;
}

/**
 * Reassemble the frames of a TCP stream: `push` the received chunks, get the
 * complete message bodies back. A chunk may hold several frames or a part of
 * one.
 */
export class FrameReader {
  constructor() {
    this.pending = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {Buffer[]} the complete frame bodies, in order
   */
  push(chunk) {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const bodies = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        throw new Error(`Frame of ${length} bytes exceeds the ${MAX_FRAME_BYTES} bytes limit`);
      }
      if (this.pending.length < 4 + length) {
        break;
      }
      bodies.push(this.pending.subarray(4, 4 + length));
      this.pending = this.pending.subarray(4 + length);
    }
    return bodies;
  }
}

/**
 * Parse the JSON payload of a decoded message; `null` for a binary or
 * malformed payload (never thrown: a device bug must not kill the session).
 * @param {{ payloadUtf8?: string }} message
 * @returns {object | null}
 */
export function parsePayload(message) {
  if (typeof message.payloadUtf8 !== 'string') {
    return null;
  }
  try {
    const data = JSON.parse(message.payloadUtf8);
    return data !== null && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}
