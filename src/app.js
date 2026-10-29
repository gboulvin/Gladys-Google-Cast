// -----------------------------------------------------------------------------
// The wiring between the SDK and the Cast manager: every handler the
// integration answers, registered on the client it is given. index.js passes
// the real one, the tests the fake Gladys of the SDK — so the tests run the
// exact wiring that ships.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CastManager } from './manager.js';
import { ACTIONS } from './actions.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS, refreshWidgets } from './widgets.js';
import { fetchArtwork } from './artwork.js';
import { t } from './i18n.js';

const logger = createLogger({ name: 'app' });

/**
 * Register every handler on `gladys`. Call it BEFORE `gladys.connect()`.
 * @param {object} gladys the SDK client
 * @param {object} [options] forwarded to the CastManager (tests)
 * @returns {CastManager}
 */
export function registerHandlers(gladys, options = {}) {
  const manager = new CastManager(gladys, {
    onWidgetsChanged: () => refreshWidgets(gladys),
    ...options,
  });

  // --- Discovery: the user opened the Discovery tab ---------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> browsing the network');
    await manager.publishDiscovered();
    manager.syncControllers();
  });

  // --- Commands: volume, play/pause, seek, announcements ---------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id}`);
    await manager.setValue(device, feature, value);
  });

  // --- The user created, renamed or deleted a device -------------------------
  // The SDK has already updated `gladys.devices`: follow what it now holds.
  const followDevices = async () => {
    manager.syncControllers();
    await manager.republishAll();
  };
  gladys.onDeviceCreated(followDevices);
  gladys.onDeviceUpdated(followDevices);
  gladys.onDeviceDeleted(followDevices);

  // --- Manifest actions: buttons in the Configuration screen -----------------
  for (const [actionKey, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { manager, fields }));
  }

  // --- Scene actions ---------------------------------------------------------
  // The triggers need no handler: the manager fires them (publishSceneEvent).
  for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(actionKey, (fields) => handler(manager, { fields }));
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, manager }));
    if (typeof widget.action === 'function') {
      gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
        widget.action(gladys, { manager, actionKey, params, settings }),
      );
    }
  }
  // The player widget shows the artwork of the "now playing" card, same key.
  gladys.onWidgetGetImage((key) => fetchArtwork(gladys.artworkUrls.get(key)));

  // --- Configuration updated by the user -------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    manager.setConfig(newConfig);
    // New manual addresses, groups shown or hidden: browse again.
    await manager.publishDiscovered();
    manager.syncControllers();
  });

  // --- Connection lifecycle --------------------------------------------------
  // The Cast connections do not depend on the Gladys one: they stay up while
  // Gladys restarts, and the states are re-published on reconnection.
  gladys.on('connected', async () => {
    try {
      manager.setConfig(await gladys.getConfig());
      // Reconnect the created devices at their stored address right away,
      // then refresh the addresses from the network.
      manager.syncControllers();
      await manager.republishAll();
      await manager.publishDiscovered();
      manager.syncControllers();
      refreshWidgets(gladys);
      await gladys.setConnectionStatus(true);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, t('init_failed')).catch(() => {});
    }
  });

  // --- Graceful shutdown -----------------------------------------------------
  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> closing the Cast connections`);
    manager.stop();
  });

  return manager;
}
