// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals
// with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Addresses of Cast devices mDNS cannot reach, e.g. "192.168.1.20, 192.168.1.21:8009".
  manual_hosts: '',
  // Offer the speaker groups (virtual devices) next to the real ones.
  include_groups: true,
  // Volume (%) of the Gladys announcements; 0 keeps the current volume.
  notification_volume: 0,
  // Duration of the mDNS browse, in seconds.
  scan_timeout: 5,
};

const clamp = (value, min, max, fallback) => {
  // Number(null) and Number('') are 0: an empty field is no value.
  const number = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    manual_hosts: typeof raw.manual_hosts === 'string' ? raw.manual_hosts : '',
    // Anything but an explicit false (or "false" from a form) means true.
    include_groups: raw.include_groups !== false && raw.include_groups !== 'false',
    notification_volume: Math.round(
      clamp(raw.notification_volume, 0, 100, DEFAULT_CONFIG.notification_volume),
    ),
    scan_timeout: Math.round(clamp(raw.scan_timeout, 2, 30, DEFAULT_CONFIG.scan_timeout)),
  };
}
