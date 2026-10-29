import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameReader,
  MAX_FRAME_BYTES,
  NAMESPACES,
  decodeMessage,
  encodeMessage,
  parsePayload,
} from '../src/cast/protocol.js';

const sample = {
  sourceId: 'sender-0',
  destinationId: 'receiver-0',
  namespace: NAMESPACES.RECEIVER,
  data: { type: 'GET_STATUS', requestId: 7, text: 'é ✓' },
};

test('a framed message decodes back to what was encoded', () => {
  const bytes = encodeMessage(sample);
  assert.equal(bytes.readUInt32BE(0), bytes.length - 4, 'the prefix is the body length');
  const message = decodeMessage(bytes.subarray(4));
  assert.equal(message.protocolVersion, 0);
  assert.equal(message.sourceId, sample.sourceId);
  assert.equal(message.destinationId, sample.destinationId);
  assert.equal(message.namespace, sample.namespace);
  assert.equal(message.payloadType, 0);
  assert.deepEqual(parsePayload(message), sample.data);
});

test('the encoding matches the protobuf wire format', () => {
  // Field 1 (varint 0), then field 2 as a length-delimited string.
  const body = encodeMessage(sample).subarray(4);
  assert.deepEqual([...body.subarray(0, 4)], [0x08, 0x00, 0x12, 'sender-0'.length]);
});

test('a payload larger than 127 bytes uses a multi-byte length', () => {
  const data = { type: 'LOAD', blob: 'x'.repeat(5000) };
  const bytes = encodeMessage({ ...sample, data });
  assert.deepEqual(parsePayload(decodeMessage(bytes.subarray(4))), data);
});

test('unknown fields are skipped, a binary payload is kept', () => {
  const body = Buffer.concat([
    Buffer.from([0x08, 0x00]),
    Buffer.from([0x22, 0x03]),
    Buffer.from('abc'),
    // field 9, 64-bit (skipped)
    Buffer.from([0x49, 1, 2, 3, 4, 5, 6, 7, 8]),
    // field 10, 32-bit (skipped)
    Buffer.from([0x55, 1, 2, 3, 4]),
    Buffer.from([0x28, 0x01, 0x3a, 0x02, 0xff, 0x00]),
  ]);
  const message = decodeMessage(body);
  assert.equal(message.namespace, 'abc');
  assert.equal(message.payloadType, 1);
  assert.deepEqual([...message.payloadBinary], [0xff, 0x00]);
  assert.equal(parsePayload(message), null, 'a binary payload has no JSON');
});

test('a truncated message is refused', () => {
  const body = encodeMessage(sample).subarray(4);
  assert.throws(() => decodeMessage(body.subarray(0, body.length - 3)), /Truncated/);
});

test('the frame reader reassembles split and merged chunks', () => {
  const first = encodeMessage(sample);
  const second = encodeMessage({ ...sample, data: { type: 'PING' } });
  const stream = Buffer.concat([first, second]);
  const reader = new FrameReader();
  const bodies = [
    ...reader.push(stream.subarray(0, 3)),
    ...reader.push(stream.subarray(3, first.length + 5)),
    ...reader.push(stream.subarray(first.length + 5)),
  ];
  assert.equal(bodies.length, 2);
  assert.deepEqual(parsePayload(decodeMessage(bodies[1])), { type: 'PING' });
});

test('the frame reader refuses an oversized frame', () => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
  assert.throws(() => new FrameReader().push(header), /exceeds/);
});

test('a malformed JSON payload reads as null, never throws', () => {
  assert.equal(parsePayload({ payloadUtf8: '{oops' }), null);
  assert.equal(parsePayload({ payloadUtf8: '"a string"' }), null);
  assert.equal(parsePayload({}), null);
});
