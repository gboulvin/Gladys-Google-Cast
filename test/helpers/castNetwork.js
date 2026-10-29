// -----------------------------------------------------------------------------
// A fake local network for the manager tests: the fake Gladys of the SDK
// (createFakeGladys) answers the mDNS scan with `devices`, and every Cast
// connection reaches the FakeCastDevice listening at its address.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CastClient } from '../../src/cast/client.js';
import { CastController } from '../../src/cast/controller.js';
import { registerHandlers } from '../../src/app.js';
import { FakeCastDevice } from './fakeCastDevice.js';

export const KITCHEN = { id: 'aaaa1111', name: 'Kitchen speaker', host: '192.168.1.30' };
export const TV = { id: 'bbbb2222', name: 'Living room TV', host: '192.168.1.31' };

export function mdnsAnswer({ id, name, host, port = 8009, model = 'Google Nest Mini' }) {
  return {
    name: `${model}-${id}._googlecast._tcp.local`,
    host: `${id}.local`,
    addresses: [host],
    port,
    txt: [`id=${id}`, `fn=${name}`, `md=${model}`],
  };
}

/**
 * @param {object} [options]
 * @param {object[]} [options.cast] the Cast devices on the network
 * @param {object} [options.config]
 */
export function createCastNetwork({ cast = [KITCHEN, TV], config = {} } = {}) {
  const gladys = createFakeGladys({
    config,
    scanResults: { mdns: cast.map(mdnsAnswer) },
  });
  const devices = new Map(cast.map((entry) => [entry.host, new FakeCastDevice()]));
  const widgetRefreshes = [];
  // The real wiring of index.js, on the fake Gladys.
  const manager = registerHandlers(gladys, {
    controllerFactory: (options) =>
      new CastController({
        ...options,
        reconnectDelaysMs: [1000],
        clientFactory: (opts) =>
          new CastClient({
            ...opts,
            requestTimeoutMs: 500,
            socketFactory: () => {
              const device = devices.get(opts.host) ?? new FakeCastDevice({ reachable: false });
              return device.open();
            },
          }),
      }),
    onWidgetsChanged: () => widgetRefreshes.push(Date.now()),
  });
  manager.setConfig(config);
  return { gladys, manager, devices, widgetRefreshes };
}

/** Discover, then let the user create every discovered device. */
export async function createAllDevices({ gladys, manager }) {
  await manager.publishDiscovered();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  manager.syncControllers();
}
