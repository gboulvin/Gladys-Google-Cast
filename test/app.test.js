// The lifecycle and the Configuration screen, through the real wiring
// (src/app.js) on the fake Gladys of the SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castIds } from '../src/devices/castDevice.js';
import { OVERVIEW_WIDGET, PLAYER_WIDGET } from '../src/widgets.js';
import { settle } from './helpers/fakeCastDevice.js';
import { KITCHEN, createAllDevices, createCastNetwork } from './helpers/castNetwork.js';

test('on connection: config read, devices discovered, status reported', async (t) => {
  const network = createCastNetwork({ config: { include_groups: false } });
  t.after(() => network.manager.stop());
  await network.gladys.connect();
  assert.equal(network.manager.config.include_groups, false);
  assert.equal(network.gladys.fake.discoveredDevices.length, 2);
  assert.equal(network.gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(
    [...new Set(network.gladys.fake.widgetRefreshes)].sort(),
    [OVERVIEW_WIDGET, PLAYER_WIDGET].sort(),
  );
});

test('a failed initialization is reported in the Configuration screen', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  t.mock.method(network.gladys, 'publishDiscoveredDevices', async () => {
    throw new Error('boom');
  });
  await network.gladys.connect();
  const status = network.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.ok(status.message.es, 'the message is translated');
});

test('the Discovery tab triggers a scan', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await network.gladys.fake.scanRequest();
  assert.equal(network.gladys.fake.discoveredDevices.length, 2);
});

test('creating a device connects it and publishes its state', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await network.gladys.fake.scanRequest();
  const [kitchen] = network.gladys.fake.discoveredDevices;
  await network.gladys.fake.deviceCreated(kitchen);
  await settle(20);
  assert.equal(network.gladys.fake.lastState(`${kitchen.external_id}:volume`), 40);
  await network.gladys.fake.deviceDeleted(kitchen);
  assert.equal(network.manager.controllers.size, 0);
});

test('a new configuration re-scans with the manual addresses', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await network.gladys.fake.configUpdated({ manual_hosts: '10.0.0.9', include_groups: true });
  const ids = network.gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes(castIds(network.gladys, 'manual-10-0-0-9-8009').device));
});

test('the "Test a device" action describes the device in four languages', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  network.devices.get(KITCHEN.host).startApp('233637DE', 'YouTube');
  await settle(20);
  const ack = await network.gladys.fake.action('test_connection', {
    device: castIds(network.gladys, KITCHEN.id).device,
  });
  assert.equal(ack.success, true);
  assert.deepEqual(Object.keys(ack.data.message).sort(), ['de', 'en', 'es', 'fr']);
  const message = ack.data.message;
  assert.equal(message.en, 'Kitchen speaker answers: volume 40%, casting YouTube.');
  assert.equal(message.fr, 'Kitchen speaker répond : volume 40 %, diffuse YouTube.');

  const unknown = await network.gladys.fake.action('test_connection', { device: 'ext:x' });
  assert.match(unknown.data.message.en, /not a Google Cast device/);
});

test('the "Search the network" action reports what it found', async (t) => {
  const network = createCastNetwork({ config: { manual_hosts: 'bad_host' } });
  t.after(() => network.manager.stop());
  const ack = await network.gladys.fake.action('scan_network', {});
  const message = ack.data.message;
  assert.match(message.en, /^2 Google Cast device\(s\) found\. .* Ignored addresses: bad_host\.$/);
});

test('shutdown closes every Cast connection', async (t) => {
  const network = createCastNetwork();
  t.after(() => network.manager.stop());
  await createAllDevices(network);
  await settle(20);
  await network.gladys.fake.shutdown('SIGTERM');
  assert.equal(network.manager.controllers.size, 0);
  await settle(20);
  assert.ok(network.devices.get(KITCHEN.host).socket.destroyed);
});
