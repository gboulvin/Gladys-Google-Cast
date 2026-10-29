// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen. Each handler
// resolves the multi-language message shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

const logger = createLogger({ name: 'actions' });

export const ACTIONS = {
  // Reach one device and say what it is doing.
  async test_connection(gladys, { manager, fields }) {
    logger.info(`Action test_connection <- ${fields.device}`);
    let controller;
    try {
      controller = manager.controllerOf(fields.device);
    } catch {
      return t('device_unknown');
    }
    try {
      await controller.ensureConnected();
      const { volume, app } = controller.snapshot();
      return t('test_ok', {
        name: controller.name,
        volume: volume ?? '?',
        app: app && !app.isIdleScreen ? t('app_running', { app: app.name }) : t('app_none'),
      });
    } catch (err) {
      return t('test_failed', { name: controller.name, error: err.message });
    }
  },

  // Browse the network again: new devices in the Discovery tab, new
  // addresses for the known ones.
  async scan_network(gladys, { manager }) {
    logger.info('Action scan_network');
    const { records, invalid } = await manager.publishDiscovered();
    manager.syncControllers();
    const message = t('scan_result', { count: records.length });
    if (invalid.length === 0) {
      return message;
    }
    const ignored = t('scan_invalid_hosts', { hosts: invalid.join(', ') });
    return Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, `${text} ${ignored[lang]}`]),
    );
  },
};
