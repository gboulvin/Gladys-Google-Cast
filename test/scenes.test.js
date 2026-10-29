import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { castIds } from '../src/devices/castDevice.js';
import { SCENE_TRIGGERS } from '../src/manager.js';
import { NAMESPACES } from '../src/cast/protocol.js';
import { settle } from './helpers/fakeCastDevice.js';
import { KITCHEN, TV, createAllDevices, createCastNetwork } from './helpers/castNetwork.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

async function setup(t) {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  return network;
}

function assertDeclaredOutputs(key, outputs) {
  const declared = keysOf(declarationOf('scene_actions', key).outputs);
  assert.deepEqual(Object.keys(outputs).sort(), [...declared].sort(), `${key} outputs`);
}

test('cast_media plays the URL at the chosen volume', async (t) => {
  const { gladys, devices } = await setup(t);
  const ack = await gladys.fake.sceneAction('cast_media', {
    device: castIds(gladys, TV.id).device,
    url: 'https://icecast.example.com/radio.aac',
    content_type: 'auto',
    title: 'My radio',
    live: true,
    volume: 25,
  });
  assert.equal(ack.success, true);
  assertDeclaredOutputs('cast_media', ack.data.outputs);
  assert.deepEqual(ack.data.outputs, { played: true });
  const cast = devices.get(TV.host);
  const [load] = cast.requests(NAMESPACES.MEDIA, 'LOAD');
  assert.equal(load.media.contentType, 'audio/aac');
  assert.equal(load.media.streamType, 'LIVE');
  assert.equal(load.media.metadata.title, 'My radio');
  assert.equal(cast.volume, 0.25);
});

test('cast_media on an unreachable device is an output, a bad URL an error', async (t) => {
  const { gladys, devices } = await setup(t);
  const cast = devices.get(TV.host);
  cast.reachable = false;
  cast.disconnect();
  await settle(20);
  const ack = await gladys.fake.sceneAction('cast_media', {
    device: castIds(gladys, TV.id).device,
    url: 'https://example.com/a.mp3',
  });
  assert.deepEqual(ack.data.outputs, { played: false });

  const invalid = await gladys.fake.sceneAction('cast_media', {
    device: castIds(gladys, TV.id).device,
    url: 'ftp://example.com/a.mp3',
  });
  assert.equal(invalid.success, false);
});

test('play_sound restores the previous volume after the sound', async (t) => {
  const { gladys, devices } = await setup(t);
  const cast = devices.get(KITCHEN.host);
  const ack = await gladys.fake.sceneAction('play_sound', {
    device: castIds(gladys, KITCHEN.id).device,
    url: 'https://example.com/chime.mp3',
    volume: 90,
  });
  assertDeclaredOutputs('play_sound', ack.data.outputs);
  assert.deepEqual(ack.data.outputs, { played: true });
  assert.equal(cast.volume, 0.9);
  cast.media = { ...cast.media, playerState: 'IDLE', idleReason: 'FINISHED' };
  cast.pushMediaStatus();
  await settle(20);
  assert.equal(cast.volume, 0.4);
});

test('stop_casting quits the app, and reports when nothing was casting', async (t) => {
  const { gladys, devices } = await setup(t);
  const device = castIds(gladys, KITCHEN.id).device;
  let ack = await gladys.fake.sceneAction('stop_casting', { device });
  assertDeclaredOutputs('stop_casting', ack.data.outputs);
  assert.deepEqual(ack.data.outputs, { stopped: false });
  devices.get(KITCHEN.host).startApp('233637DE', 'YouTube');
  await settle(20);
  ack = await gladys.fake.sceneAction('stop_casting', { device });
  assert.deepEqual(ack.data.outputs, { stopped: true });
});

test('launch_app opens the app, refuses a malformed id', async (t) => {
  const { gladys, devices } = await setup(t);
  const device = castIds(gladys, KITCHEN.id).device;
  const ack = await gladys.fake.sceneAction('launch_app', { device, app_id: '233637DE' });
  assertDeclaredOutputs('launch_app', ack.data.outputs);
  assert.deepEqual(ack.data.outputs, { launched: true });
  assert.equal(devices.get(KITCHEN.host).app.appId, '233637DE');
  const bad = await gladys.fake.sceneAction('launch_app', { device, app_id: '../x' });
  assert.equal(bad.success, false);
  const refused = await gladys.fake.sceneAction('launch_app', { device, app_id: 'BADAPP' });
  assert.deepEqual(refused.data.outputs, { launched: false });
});

test('a scene action on an unknown device is an output too', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.sceneAction('stop_casting', { device: 'ext:test-integration:x' });
  assert.deepEqual(ack.data.outputs, { stopped: false });
});

test('every scene event carries only declared, primitive data', async (t) => {
  const { gladys, devices } = await setup(t);
  devices.get(KITCHEN.host).startApp('CC32E753', 'Spotify', {
    playerState: 'PLAYING',
    media: { contentId: 'x', metadata: { title: 'T', artist: 'A' } },
  });
  await settle(20);
  const cast = devices.get(KITCHEN.host);
  cast.media = { ...cast.media, playerState: 'IDLE', idleReason: 'ERROR' };
  cast.pushMediaStatus();
  await settle(20);
  cast.disconnect();
  await settle(20);

  const fired = new Set(gladys.fake.sceneEvents.map((e) => e.key));
  assert.deepEqual([...fired].sort(), Object.values(SCENE_TRIGGERS).sort(), 'every trigger fired');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} primitive`);
    }
    for (const field of trigger.fields.filter((f) => f.options)) {
      assert.ok(
        field.options.some((option) => option.value === data[field.key]),
        `${key}: ${field.key} "${data[field.key]}" must be one of the filter options`,
      );
    }
  }
});
