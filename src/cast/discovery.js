// -----------------------------------------------------------------------------
// Finding the Cast devices of the local network.
//
// The integration container sits on a Docker bridge: mDNS never reaches it.
// The Gladys core (host network) browses `_googlecast._tcp` on its behalf
// (manifest `network_discovery`, `gladys.scanNetwork('mdns')`) and hands back
// the raw answers, parsed here. The addresses the user types in the
// configuration complete the list, for the networks mDNS does not cross
// (VLANs, separate Wi-Fi for the IoT devices...).
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { DEFAULT_CAST_PORT } from './client.js';

export const MDNS_SERVICE = '_googlecast._tcp';

// The model name a speaker group advertises.
const GROUP_MODEL = 'Google Cast Group';

/**
 * @typedef {object} CastRecord
 * @property {string} id stable id of the device: the Cast UUID, or
 *   `manual-<host>-<port>` for an address typed by the user
 * @property {string} name friendly name
 * @property {string} model
 * @property {string} host
 * @property {number} port
 * @property {boolean} isGroup a speaker group (a virtual device)
 * @property {boolean} manual
 */

function pickAddress(addresses = []) {
  return addresses.find((address) => isIP(address) === 4) ?? addresses[0] ?? null;
}

// The instance name is "<model>-<uuid>._googlecast._tcp.local".
function nameFromInstance(name = '') {
  return name.replace(/\._googlecast\._tcp.*$/i, '');
}

/**
 * Turn the raw answers of an mDNS scan into Cast records, deduplicated by id.
 * @param {Array<{ name: string, host?: string, addresses?: string[], port?: number, txt?: string[] }>} results
 * @param {{ includeGroups?: boolean }} [options]
 * @returns {CastRecord[]}
 */
export function parseMdnsResults(results, { includeGroups = true } = {}) {
  const records = new Map();
  for (const result of results ?? []) {
    const txt = parseMdnsTxt(result.txt ?? []);
    const id = typeof txt.id === 'string' ? txt.id.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const host = pickAddress(result.addresses) ?? result.host ?? null;
    if (!id || !host || records.has(id)) {
      continue;
    }
    const model = typeof txt.md === 'string' ? txt.md : '';
    const isGroup = model === GROUP_MODEL;
    if (isGroup && !includeGroups) {
      continue;
    }
    records.set(id, {
      id,
      name: (typeof txt.fn === 'string' && txt.fn) || nameFromInstance(result.name) || model || id,
      model,
      host,
      port: Number.isInteger(result.port) ? result.port : DEFAULT_CAST_PORT,
      isGroup,
      manual: false,
    });
  }
  return [...records.values()];
}

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Parse the `manual_hosts` setting: addresses separated by commas, spaces or
 * semicolons, each `host` or `host:port`.
 * @param {string} value
 * @returns {{ hosts: Array<{ host: string, port: number }>, invalid: string[] }}
 */
export function parseManualHosts(value) {
  const hosts = [];
  const invalid = [];
  const entries = String(value ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^(.+?)(?::(\d{1,5}))?$/);
    const host = match?.[1] ?? '';
    const port = match?.[2] ? Number(match[2]) : DEFAULT_CAST_PORT;
    // All digits and dots: an IPv4 address or nothing (999.1.1.1 is no host name).
    const validHost = /^[\d.]+$/.test(host) ? isIP(host) === 4 : HOSTNAME.test(host);
    if (!validHost || port < 1 || port > 65535) {
      invalid.push(entry);
      continue;
    }
    if (!hosts.some((known) => known.host === host && known.port === port)) {
      hosts.push({ host, port });
    }
  }
  return { hosts, invalid };
}

/**
 * The record of an address typed by the user. A Cast device does not tell its
 * UUID over the Cast protocol: the address is the identity, so the device
 * should keep a fixed address (a DHCP reservation).
 * @param {{ host: string, port: number }} address
 * @returns {CastRecord}
 */
export function manualRecord({ host, port }) {
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: `manual-${slug}-${port}`,
    name: `Google Cast ${host}`,
    model: '',
    host,
    port,
    isGroup: false,
    manual: true,
  };
}
