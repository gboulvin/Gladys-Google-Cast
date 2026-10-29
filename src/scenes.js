// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Operations a scene author places in a scene, with their outputs. index.js
// registers every entry with `gladys.onSceneAction(key, ...)`.
//
//   - `fields` arrive RESOLVED (scene variables substituted, defaults
//     applied); a `"source": "devices"` field is the device external_id;
//   - a device that cannot do it (unreachable, nothing casting) is an OUTPUT,
//     not a failure: the scene author gates the next actions on it. Only a
//     wrong input (an invalid URL) throws;
//   - what these actions start fires no scene event (see
//     CastController.isOwnMedia): a scene would otherwise loop through the
//     integration.
//
// The scene TRIGGERS are fired by the manager, from the device states (see
// CastManager.detectEvents).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { assertMediaUrl } from './cast/media.js';

const logger = createLogger({ name: 'scenes' });

/**
 * Run a device operation and report its success as a boolean output.
 */
async function attempt(manager, externalId, label, operation) {
  let controller;
  try {
    controller = manager.controllerOf(externalId);
  } catch (err) {
    logger.warn(`${label}: ${err.message}`);
    return false;
  }
  try {
    return (await operation(controller)) !== false;
  } catch (err) {
    logger.warn(`${label} on ${controller.name} failed: ${err.message}`);
    return false;
  }
}

const isVolume = (value) =>
  value !== undefined && value !== null && value !== '' && Number(value) > 0;

export const SCENE_ACTIONS = {
  // Cast any media URL (a web radio, a video, a picture) to a device.
  async cast_media(manager, { fields }) {
    const url = assertMediaUrl(fields.url);
    logger.info(`Scene action cast_media <- ${fields.device}`);
    const played = await attempt(manager, fields.device, 'cast_media', async (controller) => {
      if (isVolume(fields.volume)) {
        await controller.setVolume(Number(fields.volume));
      }
      await controller.loadMedia({
        url,
        contentType: fields.content_type,
        title: fields.title,
        live: fields.live === true,
      });
    });
    return { played };
  },

  // A short sound (doorbell chime, alarm), then back to the previous volume.
  async play_sound(manager, { fields }) {
    const url = assertMediaUrl(fields.url);
    logger.info(`Scene action play_sound <- ${fields.device}`);
    const played = await attempt(manager, fields.device, 'play_sound', (controller) =>
      controller.playNotification(url, {
        volume: isVolume(fields.volume) ? Number(fields.volume) : undefined,
      }),
    );
    return { played };
  },

  // Quit whatever app casts to the device.
  async stop_casting(manager, { fields }) {
    logger.info(`Scene action stop_casting <- ${fields.device}`);
    const stopped = await attempt(manager, fields.device, 'stop_casting', (controller) =>
      controller.stopApp(),
    );
    return { stopped };
  },

  // Open a Cast app by its id (e.g. 233637DE for YouTube).
  async launch_app(manager, { fields }) {
    const appId = String(fields.app_id ?? '').trim();
    if (!/^[A-Za-z0-9]{1,32}$/.test(appId)) {
      throw new Error(`Invalid Cast app id: ${fields.app_id}`);
    }
    logger.info(`Scene action launch_app ${appId} <- ${fields.device}`);
    const launched = await attempt(manager, fields.device, 'launch_app', (controller) =>
      controller.launchApp(appId),
    );
    return { launched };
  },
};
