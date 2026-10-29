import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualRecord, parseManualHosts, parseMdnsResults } from '../src/cast/discovery.js';

const chromecast = {
  name: 'Chromecast-3a1b2c3d4e5f60718293a4b5c6d7e8f9._googlecast._tcp.local',
  host: '3a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.local',
  addresses: ['fe80::1', '192.168.1.30'],
  port: 8009,
  txt: ['id=3a1b2c3d4e5f60718293a4b5c6d7e8f9', 'md=Chromecast', 'fn=Living room TV', 'rs='],
};
const group = {
  name: 'Google-Cast-Group-aa._googlecast._tcp.local',
  addresses: ['192.168.1.31'],
  port: 32187,
  txt: ['id=AA-BB-CC', 'md=Google Cast Group', 'fn=Whole house'],
};

test('mDNS answers become Cast records, IPv4 first', () => {
  const [record] = parseMdnsResults([chromecast]);
  assert.deepEqual(record, {
    id: '3a1b2c3d4e5f60718293a4b5c6d7e8f9',
    name: 'Living room TV',
    model: 'Chromecast',
    host: '192.168.1.30',
    port: 8009,
    isGroup: false,
    manual: false,
  });
});

test('speaker groups keep their own port, and can be left out', () => {
  const records = parseMdnsResults([chromecast, group]);
  const whole = records.find((r) => r.isGroup);
  assert.equal(whole.port, 32187);
  assert.equal(whole.id, 'aabbcc', 'the id is normalized');
  assert.equal(parseMdnsResults([chromecast, group], { includeGroups: false }).length, 1);
});

test('duplicates and answers without id or address are dropped', () => {
  const records = parseMdnsResults([
    chromecast,
    { ...chromecast, addresses: ['192.168.1.99'] },
    { ...chromecast, txt: ['fn=No id'] },
    { name: 'x', txt: ['id=ff'], addresses: [] },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].host, '192.168.1.30', 'the first answer wins');
});

test('the name falls back on the mDNS instance name', () => {
  const [record] = parseMdnsResults([{ ...chromecast, txt: ['id=12ab'] }]);
  assert.equal(record.name, 'Chromecast-3a1b2c3d4e5f60718293a4b5c6d7e8f9');
});

test('manual addresses: separators, ports, invalid entries, duplicates', () => {
  const { hosts, invalid } = parseManualHosts(
    ' 192.168.1.20, 192.168.1.21:8010;tv.local  192.168.1.20 999.1.1.1 host:70000 bad_name',
  );
  assert.deepEqual(hosts, [
    { host: '192.168.1.20', port: 8009 },
    { host: '192.168.1.21', port: 8010 },
    { host: 'tv.local', port: 8009 },
  ]);
  assert.deepEqual(invalid, ['999.1.1.1', 'host:70000', 'bad_name']);
  assert.deepEqual(parseManualHosts(''), { hosts: [], invalid: [] });
  assert.deepEqual(parseManualHosts(undefined), { hosts: [], invalid: [] });
});

test('a manual record gets a stable id from its address', () => {
  assert.deepEqual(manualRecord({ host: '192.168.1.20', port: 8009 }), {
    id: 'manual-192-168-1-20-8009',
    name: 'Google Cast 192.168.1.20',
    model: '',
    host: '192.168.1.20',
    port: 8009,
    isGroup: false,
    manual: true,
  });
});
