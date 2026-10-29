import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('an empty config gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
});

test('form values are typed and bounded', () => {
  const config = normalizeConfig({
    manual_hosts: '192.168.1.20',
    include_groups: 'false',
    notification_volume: '150',
    scan_timeout: '1',
  });
  assert.equal(config.manual_hosts, '192.168.1.20');
  assert.equal(config.include_groups, false);
  assert.equal(config.notification_volume, 100);
  assert.equal(config.scan_timeout, 2);
});

test('garbage falls back to the defaults', () => {
  const config = normalizeConfig({
    manual_hosts: 42,
    notification_volume: 'loud',
    scan_timeout: null,
  });
  assert.equal(config.manual_hosts, '');
  assert.equal(config.notification_volume, 0);
  assert.equal(config.scan_timeout, DEFAULT_CONFIG.scan_timeout);
});
