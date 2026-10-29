// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code,
// plus the store rules that are easiest to miss. The store validator
// (`npx github:GladysAssistant/integration-store .`) stays the reference.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { SCENE_TRIGGERS } from '../src/manager.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { CONTENT_TYPE_OPTIONS } from '../src/cast/media.js';
import { MDNS_SERVICE } from '../src/cast/discovery.js';
import { LANGUAGES, MESSAGE_KEYS, t } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// First Gladys release accepting each manifest field (older cores reject an
// unknown field; the store refuses a lower `gladys_version` minimum).
const FIELD_MIN_GLADYS_VERSION = {
  categories: [4, 86, 0],
  widgets: [5, 1, 0],
  scene_triggers: [5, 1, 0],
  scene_actions: [5, 1, 0],
  keywords: [5, 3, 0],
  countries: [5, 3, 0],
  music: [5, 3, 0],
};

const STORE_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language text of the manifest, with its path.
function* multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      yield* multiLanguageTexts(item, `${path}.${index}`);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      ['label', 'description', 'placeholder'].includes(key) &&
      value &&
      typeof value === 'object'
    ) {
      yield [`${path}.${key}`, value];
    } else {
      yield* multiLanguageTexts(value, `${path}.${key}`);
    }
  }
}

test('every manifest text exists in English, French, German and Spanish', () => {
  for (const [path, text] of multiLanguageTexts(manifest)) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const [lang, value] of Object.entries(text)) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${path}.${lang} is empty`);
    }
  }
});

test('every message of the code exists in the four languages', () => {
  for (const key of MESSAGE_KEYS) {
    const message = t(key);
    assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort(), key);
    for (const text of Object.values(message)) {
      assert.ok(text.length > 0, `${key} is empty`);
    }
  }
  assert.throws(() => t('nope'), /Unknown message/);
});

test('the integration is local only, discovered by mDNS, and a music player', () => {
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['local'], 'no cloud: the Cast protocol is local');
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  assert.deepEqual(manifest.music, {}, 'artwork proxy only, no catalog');
});

test('usable worldwide: no `countries` restriction', () => {
  // Google Cast is a local protocol, without any account or regional cloud:
  // an absent `countries` field lists the integration in every country.
  assert.equal(manifest.countries, undefined);
});

test('catalog categories and keywords follow the store vocabulary', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const category of manifest.categories) {
    assert.ok(STORE_CATEGORIES.includes(category), `unknown category ${category}`);
  }
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords unique once lowercased');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
});

test('gladys_version covers every manifest field declared', () => {
  for (const [field, version] of Object.entries(FIELD_MIN_GLADYS_VERSION)) {
    if (manifest[field] !== undefined) {
      assert.ok(
        isAtLeast(minGladysVersion(), version),
        `${field} requires gladys_version >= ${version.join('.')}, got "${manifest.gladys_version}"`,
      );
    }
  }
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('the content types offered match the code', () => {
  const field = manifest.scene_actions
    .find((action) => action.key === 'cast_media')
    .fields.find((f) => f.key === 'content_type');
  assert.deepEqual(
    field.options.map((option) => option.value),
    CONTENT_TYPE_OPTIONS,
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
    assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
  }
});

test('section fields are purely presentational, at most 1000 characters', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `section "${section.key}" description too long`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('form fields follow the field grammar', () => {
  for (const field of allFields) {
    const where = `field "${field.key}"`;
    assert.match(field.key, /^[a-z0-9_]+$/, where);
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `${where}: min/max on number fields only`);
      assert.ok(field.min <= field.max, `${where}: min <= max`);
    }
    if (field.placeholder !== undefined) {
      assert.ok(['string', 'number'].includes(field.type), `${where}: placeholder type`);
    }
    if (['select', 'multi_select'].includes(field.type)) {
      assert.ok(
        (field.options === undefined) !== (field.source === undefined),
        `${where}: options or source, not both`,
      );
    } else {
      assert.equal(field.options, undefined, `${where}: options on a select only`);
      assert.equal(field.source, undefined, `${where}: source on a select only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices', where);
      assert.equal(field.default, undefined, `${where}: no default with a source`);
    }
    if (field.default !== undefined && field.type === 'select') {
      assert.ok(
        field.options.some((option) => option.value === field.default),
        where,
      );
    } else if (field.default !== undefined) {
      const expected = { string: 'string', number: 'number', boolean: 'boolean' }[field.type];
      assert.equal(typeof field.default, expected, `${where}: default type`);
    }
  }
});

test('scene triggers never filter on a boolean', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.notEqual(field.type, 'boolean', `${trigger.key}.${field.key}`);
    }
  }
});

test('keys are unique in every list', () => {
  const lists = [
    manifest.config_schema,
    manifest.actions,
    manifest.scene_triggers,
    manifest.scene_actions,
    manifest.widgets,
    ...manifest.actions.map((a) => a.fields ?? []),
    ...manifest.scene_triggers.flatMap((s) => [s.fields ?? [], s.variables ?? []]),
    ...manifest.scene_actions.flatMap((s) => [s.fields ?? [], s.outputs ?? []]),
    ...manifest.widgets.map((w) => w.settings ?? []),
  ];
  for (const list of lists) {
    const keys = keysOf(list);
    assert.equal(new Set(keys).size, keys.length, `duplicate key in ${keys.join(', ')}`);
  }
});

test('the widget texts fit the picker', () => {
  for (const widget of manifest.widgets) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}"`);
    }
    for (const text of Object.values(widget.description)) {
      assert.ok(text.length <= 100, `widget description "${text}"`);
    }
  }
});

test('timeouts stay in the 5-120 s range', () => {
  for (const item of [...manifest.actions, ...manifest.scene_actions]) {
    if (item.timeout_seconds !== undefined) {
      assert.ok(item.timeout_seconds >= 5 && item.timeout_seconds <= 120, item.key);
    }
  }
  for (const widget of manifest.widgets) {
    if (widget.action_timeout_seconds !== undefined) {
      assert.ok(widget.action_timeout_seconds >= 5 && widget.action_timeout_seconds <= 120);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
  assert.equal(manifest.docker_image, manifest.docker_image.toLowerCase(), 'ghcr is lowercase');
});

test('the name and the catalog description fit the catalog card', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});
