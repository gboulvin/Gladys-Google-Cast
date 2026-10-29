import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { castIds } from '../src/devices/castDevice.js';
import { OVERVIEW_WIDGET, PLAYER_WIDGET, WIDGETS } from '../src/widgets.js';
import { fetchArtwork } from '../src/artwork.js';
import { settle } from './helpers/fakeCastDevice.js';
import { KITCHEN, TV, createAllDevices, createCastNetwork } from './helpers/castNetwork.js';

const request = (settings = {}, language = 'en') => ({ settings, language, units: 'metric' });

async function setup(t) {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  return network;
}

async function content(gladys, key, settings, language) {
  const ack = await gladys.fake.widgetGet(key, request(settings, language));
  assert.equal(ack.success, true, ack.error);
  // [] = rendered exactly as sent: nothing dropped, truncated or over budget.
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
}

const featureIds = (gladys) =>
  new Set(gladys.devices.flatMap((device) => device.features.map((f) => f.external_id)));

test('the overview without any device invites to add them', async () => {
  const network = createCastNetwork();
  const { components } = await content(network.gladys, OVERVIEW_WIDGET);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, 'text');
  assert.match(components[0].text.de, /Google-Cast-Gerät/);
});

test('the overview lists every device with its state', async (t) => {
  const { gladys, devices } = await setup(t);
  devices.get(TV.host).startApp('CC32E753', 'Spotify', {
    playerState: 'PLAYING',
    media: { contentId: 'x', metadata: { title: 'A very long title that goes on and on forever' } },
  });
  devices.get(KITCHEN.host).disconnect();
  await settle(20);
  const { components } = await content(gladys, OVERVIEW_WIDGET);
  const status = components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.color]),
    [
      ['Kitchen speaker', 'danger'],
      ['Living room TV', 'success'],
    ],
  );
  for (const item of status.items) {
    for (const text of Object.values(item.value)) {
      assert.ok(text.length <= 40, `"${text}" fits a status row`);
    }
  }
  const caption = components.find((c) => c.type === 'text');
  assert.equal(caption.text.fr, '1 sur 2 en ligne');
});

test('the player shows the live volume, what plays and the controls', async (t) => {
  const { gladys, devices } = await setup(t);
  const device = castIds(gladys, TV.id).device;
  devices.get(TV.host).startApp('CC32E753', 'Spotify', {
    playerState: 'PLAYING',
    media: {
      contentId: 'x',
      metadata: { title: 'So What', artist: 'Miles Davis', images: [{ url: 'https://i/1.jpg' }] },
    },
  });
  await settle(20);
  const { components } = await content(gladys, PLAYER_WIDGET, { device }, 'es');
  const known = featureIds(gladys);
  for (const component of components.filter((c) => c.device_feature)) {
    assert.ok(known.has(component.device_feature), `${component.device_feature} is published`);
  }
  const image = components.find((c) => c.type === 'image');
  assert.equal(image.key, gladys.artworkKey('https://i/1.jpg'));
  const buttons = components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.icon),
    ['pause', 'skip-forward', 'x-circle'],
  );

  // The play/pause button goes through onSetValue like the core controls.
  const pause = buttons[0];
  const ack = await gladys.fake.setValue(
    gladys.devices.find((d) => d.external_id === device),
    { external_id: pause.device_feature, type: 'pause' },
    pause.value,
  );
  assert.equal(ack.success, true);
  assert.equal(devices.get(TV.host).media.playerState, 'PAUSED');

  // The stop button is a widget action, confirmed first.
  const stop = buttons[2];
  assert.equal(stop.action.confirm, true);
  const toast = await gladys.fake.widgetAction(PLAYER_WIDGET, stop.action.key, stop.action.params, {
    settings: { device },
  });
  assert.equal(toast.success, true);
  assert.equal(toast.data.message.en, 'Casting stopped.');
  assert.ok(Object.values(toast.data.message).every((text) => text.length <= 200));
  assert.equal(devices.get(TV.host).app, null);
});

test('the player of an offline or deleted device stays valid', async (t) => {
  const { gladys, devices } = await setup(t);
  devices.get(KITCHEN.host).reachable = false;
  devices.get(KITCHEN.host).disconnect();
  await settle(20);
  const offline = await content(gladys, PLAYER_WIDGET, {
    device: castIds(gladys, KITCHEN.id).device,
  });
  assert.equal(offline.components.filter((c) => c.type === 'button').length, 0);
  const missing = await content(gladys, PLAYER_WIDGET, {
    device: 'ext:test-integration:cast:gone',
  });
  assert.match(missing.components[0].text.en, /no longer exists/);
});

test('an unknown widget action fails, so the user sees the error', async () => {
  const network = createCastNetwork();
  await assert.rejects(
    WIDGETS[PLAYER_WIDGET].action(network.gladys, {
      manager: network.manager,
      actionKey: 'unknown',
      params: {},
    }),
    /Unknown widget action/,
  );
});

test('the artwork is fetched within the 300 KB budget', async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const respond =
    (bytes, headers = {}) =>
    async () =>
      new Response(bytes, { headers: { 'content-type': 'image/jpeg', ...headers } });
  assert.equal(await fetchArtwork('https://i/1.jpg', respond(image)), image.toString('base64'));
  await assert.rejects(
    fetchArtwork('https://i/1.jpg', respond(Buffer.alloc(301 * 1024))),
    /too large/,
  );
  await assert.rejects(
    fetchArtwork('https://i/1.jpg', respond(image, { 'content-type': 'text/html' })),
    /Unsupported/,
  );
  await assert.rejects(
    fetchArtwork('https://i/1.jpg', async () => new Response('', { status: 404 })),
    /HTTP 404/,
  );
  await assert.rejects(fetchArtwork(undefined), /Unknown artwork/);
});
