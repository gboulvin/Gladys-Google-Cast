import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CastClient } from '../src/cast/client.js';
import { CastController } from '../src/cast/controller.js';
import { DEFAULT_MEDIA_RECEIVER_APP_ID, NAMESPACES } from '../src/cast/protocol.js';
import { FakeCastDevice, settle } from './helpers/fakeCastDevice.js';

function createController(device, options = {}) {
  const controller = new CastController({
    id: 'abc',
    name: 'Kitchen speaker',
    host: '192.168.1.30',
    clientFactory: (opts) =>
      new CastClient({ ...opts, socketFactory: device.socketFactory, requestTimeoutMs: 500 }),
    reconnectDelaysMs: [20],
    ...options,
  });
  const updates = [];
  controller.on('update', (snapshot, previous) => updates.push({ snapshot, previous }));
  return { controller, updates };
}

test('connecting opens the receiver channel and reads the volume', async (t) => {
  const device = new FakeCastDevice({ volume: 0.35, muted: true });
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.connectNow();
  await settle();
  const snapshot = controller.snapshot();
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.volume, 35);
  assert.equal(snapshot.muted, true);
  assert.equal(snapshot.app, null);
  assert.equal(device.requests(NAMESPACES.CONNECTION, 'CONNECT').length, 1);
  assert.equal(device.requests(NAMESPACES.RECEIVER, 'GET_STATUS').length, 1);
});

test('the client answers the device PING with a PONG', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.connectNow();
  device.ping();
  await settle();
  assert.equal(device.requests(NAMESPACES.HEARTBEAT, 'PONG').length, 1);
});

test('an app cast from a phone is followed down to its media', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.connectNow();
  device.startApp('CC32E753', 'Spotify', {
    playerState: 'PLAYING',
    currentTime: 42,
    media: {
      contentId: 'spotify:track:1',
      duration: 200.4,
      metadata: {
        metadataType: 3,
        title: 'Blue in Green',
        artist: 'Miles Davis',
        albumName: 'Kind of Blue',
        images: [{ url: 'https://i.scdn.co/image/1' }],
      },
    },
  });
  await settle();
  const { app, media } = controller.snapshot();
  assert.equal(app.name, 'Spotify');
  assert.ok(
    device.received.some((m) => m.destination === app.transportId && m.data.type === 'CONNECT'),
    'the transport of the app is connected',
  );
  assert.equal(media.playerState, 'PLAYING');
  assert.equal(media.title, 'Blue in Green');
  assert.equal(media.album, 'Kind of Blue');
  assert.equal(media.duration, 200.4);
  assert.equal(media.currentTime, 42);

  // A later status without `media` keeps the known metadata.
  device.media = {
    mediaSessionId: device.media.mediaSessionId,
    playerState: 'PAUSED',
    currentTime: 50,
  };
  device.pushMediaStatus();
  await settle();
  assert.equal(controller.snapshot().media.playerState, 'PAUSED');
  assert.equal(controller.snapshot().media.title, 'Blue in Green');
});

test('volume, mute, play, pause, seek and next become Cast requests', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.connectNow();
  device.startApp('CC32E753', 'Spotify', { playerState: 'PLAYING', currentTime: 0, media: {} });
  await settle();

  await controller.setVolume(63.4);
  assert.equal(device.volume, 0.63);
  await controller.setMuted(true);
  assert.equal(device.muted, true);
  await controller.pause();
  await controller.play();
  await controller.seek(30);
  await controller.next();
  await controller.previous();
  const media = device.requests(NAMESPACES.MEDIA).map((data) => data.type);
  assert.deepEqual(
    media.filter((type) => type !== 'GET_STATUS'),
    ['PAUSE', 'PLAY', 'SEEK', 'QUEUE_UPDATE', 'QUEUE_UPDATE'],
  );
  assert.deepEqual(
    device.requests(NAMESPACES.MEDIA, 'QUEUE_UPDATE').map((data) => data.jump),
    [1, -1],
  );
  await settle();
  assert.equal(controller.snapshot().volume, 63);
});

test('a media command without media fails with a clear message', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await assert.rejects(controller.play(), /Nothing is playing on Kitchen speaker/);
});

test('loadMedia launches the Default Media Receiver, then loads the URL', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  const sessionId = await controller.loadMedia({ url: 'http://nas/radio.mp3', live: true });
  assert.equal(typeof sessionId, 'number');
  assert.equal(
    device.requests(NAMESPACES.RECEIVER, 'LAUNCH')[0].appId,
    DEFAULT_MEDIA_RECEIVER_APP_ID,
  );
  const [load] = device.requests(NAMESPACES.MEDIA, 'LOAD');
  assert.equal(load.media.contentId, 'http://nas/radio.mp3');
  assert.equal(load.media.streamType, 'LIVE');
  assert.ok(controller.isOwnMedia(sessionId), 'the integration knows it started it');
  assert.ok(controller.isOwnLaunch(DEFAULT_MEDIA_RECEIVER_APP_ID));

  // Already on the Default Media Receiver: no second launch.
  await controller.loadMedia({ url: 'http://nas/other.mp3' });
  assert.equal(device.requests(NAMESPACES.RECEIVER, 'LAUNCH').length, 1);
});

test('a refused load or launch rejects', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await assert.rejects(controller.loadMedia({ url: 'http://nas/broken.mp3' }), /LOAD_FAILED/);
  await assert.rejects(controller.launchApp('BADAPP'), /LAUNCH_ERROR: NOT_FOUND/);
});

test('a notification plays at its volume, then the previous volume comes back', async (t) => {
  const device = new FakeCastDevice({ volume: 0.2 });
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.connectNow();
  await settle();
  await controller.playNotification('http://gladys/api/v1/tts/audio/x.mp3', { volume: 70 });
  assert.equal(device.volume, 0.7);
  // The clip ends.
  device.media = { ...device.media, playerState: 'IDLE', idleReason: 'FINISHED' };
  device.pushMediaStatus();
  await settle();
  assert.equal(device.volume, 0.2);
});

test('a notification without volume leaves the volume alone', async (t) => {
  const device = new FakeCastDevice({ volume: 0.2 });
  const { controller } = createController(device);
  t.after(() => controller.stop());
  await controller.playNotification('http://gladys/api/v1/tts/audio/x.mp3', { volume: 0 });
  assert.equal(device.requests(NAMESPACES.RECEIVER, 'SET_VOLUME').length, 0);
});

test('stopApp quits the running app, and says when nothing ran', async (t) => {
  const device = new FakeCastDevice();
  const { controller } = createController(device);
  t.after(() => controller.stop());
  assert.equal(await controller.stopApp(), false);
  device.startApp('233637DE', 'YouTube');
  await settle();
  assert.equal(await controller.stopApp(), true);
  assert.equal(device.requests(NAMESPACES.RECEIVER, 'STOP').length, 1);
  await settle();
  assert.equal(controller.snapshot().app, null);
});

test('a lost device goes offline, then comes back on its own', async (t) => {
  const device = new FakeCastDevice();
  const { controller, updates } = createController(device);
  t.after(() => controller.stop());
  controller.start();
  await settle();
  assert.equal(controller.online, true);
  device.disconnect();
  await settle();
  assert.equal(controller.online, false);
  assert.ok(updates.some((u) => u.previous.online && !u.snapshot.online));
  // The reconnection delay is 20 ms in these tests.
  await new Promise((resolve) => setTimeout(resolve, 60));
  await settle();
  assert.equal(controller.online, true);
  assert.equal(device.sockets.length, 2);
});

test('an unreachable device reports its failures and keeps retrying', async (t) => {
  const device = new FakeCastDevice({ reachable: false });
  const { controller } = createController(device);
  t.after(() => controller.stop());
  const failures = [];
  controller.on('connect-failed', (count) => failures.push(count));
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(failures.length >= 2, `${failures.length} failures reported`);
  assert.deepEqual(failures.slice(0, 2), [1, 2]);
  await assert.rejects(controller.setVolume(10), /Kitchen speaker is unreachable/);
});

test('a new address reconnects right away', async (t) => {
  const device = new FakeCastDevice();
  const hosts = [];
  const { controller } = createController(device, {
    clientFactory: (opts) => {
      hosts.push(opts.host);
      return new CastClient({ ...opts, socketFactory: device.socketFactory });
    },
  });
  t.after(() => controller.stop());
  controller.start();
  await settle();
  controller.setAddress('192.168.1.31', 8009);
  await settle();
  assert.deepEqual(hosts, ['192.168.1.30', '192.168.1.31']);
  assert.equal(controller.online, true);
});
