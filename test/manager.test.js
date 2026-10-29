import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_TYPES, MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import { castIds } from '../src/devices/castDevice.js';
import { SCENE_TRIGGERS, toNowPlaying } from '../src/manager.js';
import { DEFAULT_MEDIA_RECEIVER_APP_ID, NAMESPACES } from '../src/cast/protocol.js';
import { settle } from './helpers/fakeCastDevice.js';
import { KITCHEN, TV, createAllDevices, createCastNetwork } from './helpers/castNetwork.js';

const MUSIC = DEVICE_FEATURE_TYPES.MUSIC;

const spotifyTrack = {
  playerState: 'PLAYING',
  currentTime: 10,
  media: {
    contentId: 'spotify:track:1',
    duration: 180,
    metadata: {
      title: 'So What',
      artist: 'Miles Davis',
      albumName: 'Kind of Blue',
      images: [{ url: 'https://i.scdn.co/image/1' }],
    },
  },
};

function feature(gladys, cast, type) {
  return { external_id: castIds(gladys, cast.id).feature(type), type };
}

function deviceOf(gladys, cast) {
  return gladys.devices.find((d) => d.external_id === castIds(gladys, cast.id).device);
}

test('the scan publishes one valid music player per Cast device', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  const { records } = await network.manager.publishDiscovered();
  assert.equal(records.length, 2);
  // The fake Gladys refuses an invalid category / type / unit with a 400.
  const [kitchen] = network.gladys.fake.discoveredDevices;
  assert.equal(kitchen.name, 'Kitchen speaker');
  assert.equal(kitchen.should_poll, false);
  assert.deepEqual(kitchen.params.slice(0, 2), [
    { name: 'CAST_HOST', value: '192.168.1.30' },
    { name: 'CAST_PORT', value: '8009' },
  ]);
  const types = kitchen.features.map((f) => f.type);
  for (const type of [MUSIC.VOLUME, MUSIC.PLAY_NOTIFICATION, MUSIC.TITLE, MUSIC.PLAYBACK_STATE]) {
    assert.ok(types.includes(type), `${type} feature`);
  }
  for (const f of kitchen.features) {
    assert.equal(f.external_id, `${kitchen.external_id}:${f.type}`, 'publishNowPlaying ids');
    assert.equal(typeof f.min, 'number');
    assert.equal(typeof f.max, 'number');
  }
  assert.deepEqual(network.gladys.fake.scans.at(-1)?.type ?? 'mdns', 'mdns');
});

test('manual addresses complete the scan, invalid ones are reported', async (t) => {
  const network = createCastNetwork({
    config: { manual_hosts: '192.168.1.30, 10.0.0.5:8010, nope_' },
  });
  t.after(() => network.manager.stop());
  const { records, invalid } = await network.manager.publishDiscovered();
  assert.deepEqual(
    records.map((r) => r.id),
    [KITCHEN.id, TV.id, 'manual-10-0-0-5-8010'],
    'an address already found by mDNS is not duplicated',
  );
  assert.deepEqual(invalid, ['nope_']);
});

test('a failing mDNS scan still offers the manual addresses', async (t) => {
  const network = createCastNetwork({ config: { manual_hosts: '10.0.0.5' } });
  t.after(() => network.manager.stop());
  t.mock.method(network.gladys, 'scanNetwork', async () => {
    throw new Error('403 network_discovery not declared');
  });
  const { records } = await network.manager.publishDiscovered();
  assert.deepEqual(
    records.map((r) => r.host),
    ['10.0.0.5'],
  );
});

test('only the devices created in Gladys are connected', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await network.manager.publishDiscovered();
  await network.gladys.fake.deviceCreated(network.gladys.fake.discoveredDevices[0]);
  network.manager.syncControllers();
  await settle();
  assert.deepEqual([...network.manager.controllers.keys()], [KITCHEN.id]);
  assert.equal(network.devices.get(TV.host).sockets.length, 0, 'the TV is left alone');

  // Deleted: the connection is closed.
  await network.gladys.fake.deviceDeleted(deviceOf(network.gladys, KITCHEN));
  network.manager.syncControllers();
  assert.equal(network.manager.controllers.size, 0);
});

test('a created device reconnects from its stored address, before any scan', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await network.manager.publishDiscovered();
  const [kitchen] = network.gladys.fake.discoveredDevices;
  await network.gladys.fake.deviceCreated(kitchen);
  network.manager.records.clear(); // a fresh start: nothing scanned yet
  network.manager.syncControllers();
  await settle();
  assert.equal(network.manager.controllerOf(kitchen.external_id).online, true);
});

test('connection and media become states, a transport badge and scene events', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  const { gladys, devices } = network;
  const ids = castIds(gladys, KITCHEN.id);

  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.VOLUME)), 40);
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.MUTE)), 0);
  assert.ok(
    gladys.fake.transports.some(
      (e) => e.device_external_id === ids.device && e.transport === 'local',
    ),
  );
  assert.ok(
    gladys.fake.sceneEvents.some(
      (e) => e.key === SCENE_TRIGGERS.AVAILABILITY_CHANGED && e.data.status === 'online',
    ),
  );

  devices.get(KITCHEN.host).startApp('CC32E753', 'Spotify', spotifyTrack);
  await settle(20);
  assert.equal(
    gladys.fake.lastState(ids.feature(MUSIC.PLAYBACK_STATE)),
    MUSIC_PLAYBACK_STATE.PLAYING,
  );
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.TITLE)), 'So What');
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.ARTIST)), 'Miles Davis');
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.DURATION)), 180);
  assert.match(gladys.fake.lastState(ids.feature(MUSIC.ARTWORK)), /^art-[0-9a-f]{12}$/);

  const events = gladys.fake.sceneEvents.filter((e) => e.data.device === ids.device);
  const launched = events.find((e) => e.key === SCENE_TRIGGERS.APP_LAUNCHED);
  assert.deepEqual(launched.data, { device: ids.device, app: 'Spotify', app_id: 'CC32E753' });
  const started = events.filter((e) => e.key === SCENE_TRIGGERS.PLAYBACK_STARTED);
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].data, {
    device: ids.device,
    title: 'So What',
    artist: 'Miles Davis',
    app: 'Spotify',
  });

  // Pause, then resume: one more start; the end of the track: one stop.
  const cast = devices.get(KITCHEN.host);
  cast.media = { ...cast.media, playerState: 'PAUSED' };
  cast.pushMediaStatus();
  await settle(20);
  cast.media = { ...cast.media, playerState: 'PLAYING' };
  cast.pushMediaStatus();
  await settle(20);
  cast.media = { ...cast.media, playerState: 'IDLE', idleReason: 'FINISHED' };
  cast.pushMediaStatus();
  await settle(20);
  const after = gladys.fake.sceneEvents.filter((e) => e.data.device === ids.device);
  assert.equal(after.filter((e) => e.key === SCENE_TRIGGERS.PLAYBACK_STARTED).length, 2);
  const stopped = after.filter((e) => e.key === SCENE_TRIGGERS.PLAYBACK_STOPPED);
  assert.equal(stopped.length, 1);
  assert.deepEqual(stopped[0].data, { device: ids.device, reason: 'finished', title: 'So What' });
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.PLAYBACK_STATE)), MUSIC_PLAYBACK_STATE.IDLE);

  // Power cut: offline badge, offline event, an interrupted playback.
  cast.media = { ...spotifyTrack, mediaSessionId: 500 };
  cast.pushMediaStatus();
  await settle(20);
  cast.disconnect();
  await settle(20);
  assert.ok(
    gladys.fake.transports.some(
      (e) => e.device_external_id === ids.device && e.transport === 'unreachable',
    ),
  );
  const last = gladys.fake.sceneEvents.filter((e) => e.data.device === ids.device).slice(-2);
  assert.deepEqual(
    last.map((e) => [e.key, e.data.status ?? e.data.reason]),
    [
      [SCENE_TRIGGERS.AVAILABILITY_CHANGED, 'offline'],
      [SCENE_TRIGGERS.PLAYBACK_STOPPED, 'interrupted'],
    ],
  );
  assert.equal(gladys.fake.lastState(ids.feature(MUSIC.TITLE)), '', 'nothing plays when offline');
});

test('what the integration casts itself fires no scene event', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  const before = network.gladys.fake.sceneEvents.length;
  const controller = network.manager.controllerOf(castIds(network.gladys, KITCHEN.id).device);
  await controller.loadMedia({ url: 'http://nas/radio.mp3' });
  await settle(20);
  const cast = network.devices.get(KITCHEN.host);
  cast.media = { ...cast.media, playerState: 'IDLE', idleReason: 'FINISHED' };
  cast.pushMediaStatus();
  await settle(20);
  assert.deepEqual(network.gladys.fake.sceneEvents.slice(before), []);
});

test('Gladys commands reach the device', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  const { gladys, devices } = network;
  const kitchen = deviceOf(gladys, KITCHEN);
  const cast = devices.get(KITCHEN.host);

  assert.deepEqual(
    await gladys.fake.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.VOLUME), 55),
    {
      success: true,
    },
  );
  assert.equal(cast.volume, 0.55);
  await gladys.fake.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.MUTE), 1);
  assert.equal(cast.muted, true);

  cast.startApp('CC32E753', 'Spotify', spotifyTrack);
  await settle(20);
  await network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.PLAYBACK_STATE), 0);
  await network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.PLAY), 1);
  await network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.POSITION), 90);
  await network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.NEXT), 1);
  await network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.PLAYBACK_STATE), 2);
  assert.deepEqual(
    cast
      .requests(NAMESPACES.MEDIA)
      .map((d) => d.type)
      .filter((type) => type !== 'GET_STATUS'),
    ['PAUSE', 'PLAY', 'SEEK', 'QUEUE_UPDATE', 'STOP'],
  );
  await assert.rejects(
    network.manager.setValue(kitchen, feature(gladys, KITCHEN, MUSIC.TITLE), 1),
    /cannot be controlled/,
  );
});

test('the core text-to-speech URL is played as a notification', async (t) => {
  const network = createCastNetwork({ config: { notification_volume: 80 } });
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  const { gladys, devices } = network;
  const url = 'http://192.168.1.2:1443/api/v1/tts/audio/0f3c.mp3';
  const ack = await gladys.fake.setValue(
    deviceOf(gladys, TV),
    feature(gladys, TV, MUSIC.PLAY_NOTIFICATION),
    url,
  );
  assert.deepEqual(ack, { success: true });
  const cast = devices.get(TV.host);
  assert.equal(
    cast.requests(NAMESPACES.RECEIVER, 'LAUNCH')[0].appId,
    DEFAULT_MEDIA_RECEIVER_APP_ID,
  );
  assert.equal(cast.requests(NAMESPACES.MEDIA, 'LOAD')[0].media.contentId, url);
  assert.equal(cast.volume, 0.8);

  const refused = await gladys.fake.setValue(
    deviceOf(gladys, TV),
    feature(gladys, TV, MUSIC.PLAY_NOTIFICATION),
    'javascript:alert(1)',
  );
  assert.equal(refused.success, false);
});

test('a command for an unknown device fails', async () => {
  const network = createCastNetwork();
  await assert.rejects(
    network.manager.setValue({ external_id: 'ext:other:x' }, { type: MUSIC.VOLUME }, 1),
    /Unknown Google Cast device/,
  );
});

test('a device that keeps failing triggers one address refresh', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  const scans = t.mock.method(network.gladys, 'scanNetwork');
  const controller = network.manager.controllerOf(castIds(network.gladys, KITCHEN.id).device);
  network.manager.lastAddressRefresh = 0;
  controller.emit('connect-failed', 1);
  controller.emit('connect-failed', 2);
  controller.emit('connect-failed', 3);
  await settle();
  assert.equal(scans.mock.callCount(), 1, 'rate-limited to one re-browse');
});

test('widget refreshes are coalesced to one per 10 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const network = createCastNetwork();
  network.manager.requestWidgetRefresh();
  network.manager.requestWidgetRefresh();
  network.manager.requestWidgetRefresh();
  assert.equal(network.widgetRefreshes.length, 1, 'the first one goes through');
  t.mock.timers.tick(10_500);
  assert.equal(network.widgetRefreshes.length, 2, 'the last one is never dropped');
  t.mock.timers.tick(20_000);
  assert.equal(network.widgetRefreshes.length, 2);
});

test('toNowPlaying clears everything for an offline device', () => {
  assert.deepEqual(
    toNowPlaying({
      online: false,
      volume: 30,
      muted: false,
      media: { title: 'x', playerState: 'PLAYING' },
    }),
    {
      playback_state: MUSIC_PLAYBACK_STATE.IDLE,
      title: '',
      artist: '',
      album: '',
      artwork_url: null,
      duration: 0,
      position: 0,
      volume: 30,
      mute: false,
    },
  );
});
