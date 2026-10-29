// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
//   - `cast_overview`: every Google Cast device at a glance (online, what
//     casts, what plays);
//   - `cast_player`: one device (picked in the widget settings) with its live
//     volume, what plays, the artwork and the play / pause / next / stop
//     buttons.
//
// The content is declarative and rendered by the core (theme, dark mode,
// languages). The manager nudges the dashboards when a device state changes
// (`requestWidgetRefresh`), the TTL is a safety net.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_TYPES,
  WIDGET_COLORS,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { castIdOf, castIds } from './devices/castDevice.js';
import { t } from './i18n.js';

const MUSIC = DEVICE_FEATURE_TYPES.MUSIC;

const logger = createLogger({ name: 'widgets' });

// Widget keys, as declared in the manifest `widgets` field. Forever.
export const OVERVIEW_WIDGET = 'cast_overview';
export const PLAYER_WIDGET = 'cast_player';

// Keys of the `button` actions the contents declare.
const ACTIONS = { STOP_CASTING: 'stop_casting' };

// Status rows hold at most 10 items, 40 characters each.
const MAX_STATUS_ITEMS = 10;
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * What a device is doing, as a status value and color.
 * @param {object | null} snapshot
 */
export function describeState(snapshot) {
  if (!snapshot?.online) {
    return { value: t('state_offline'), color: WIDGET_COLORS.DANGER };
  }
  const media = snapshot.media;
  const app = snapshot.app && !snapshot.app.isIdleScreen ? snapshot.app : null;
  const label = (key) => {
    const state = t(key);
    const detail = truncate(media?.title || app?.name || '', 24);
    return detail
      ? Object.fromEntries(
          Object.entries(state).map(([lang, text]) => [lang, `${text} · ${detail}`]),
        )
      : state;
  };
  switch (media?.playerState) {
    case 'PLAYING':
      return { value: label('state_playing'), color: WIDGET_COLORS.SUCCESS };
    case 'PAUSED':
      return { value: label('state_paused'), color: WIDGET_COLORS.WARNING };
    case 'BUFFERING':
    case 'LOADING':
      return { value: label('state_buffering'), color: WIDGET_COLORS.INFO };
    default:
      return app
        ? { value: truncate(app.name, 40), color: WIDGET_COLORS.PRIMARY }
        : { value: t('state_idle'), color: WIDGET_COLORS.NEUTRAL };
  }
}

function overviewContent(manager) {
  const devices = manager.listDevices();
  if (devices.length === 0) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t('widget_no_device') }],
    };
  }
  const online = devices.filter((device) => device.snapshot?.online).length;
  return {
    ttl_seconds: 60,
    components: [
      {
        type: 'text',
        variant: 'caption',
        text: t('widget_online_count', { online, total: devices.length }),
      },
      {
        type: 'status',
        items: devices.slice(0, MAX_STATUS_ITEMS).map((device) => ({
          label: truncate(device.name, 40),
          icon: 'cast',
          ...describeState(device.snapshot),
        })),
      },
    ],
  };
}

function playerContent(gladys, manager, deviceExternalId) {
  const castId = castIdOf(gladys, deviceExternalId);
  const device = manager.listDevices().find((entry) => entry.externalId === deviceExternalId);
  if (!castId || !device) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t('widget_device_missing') }],
    };
  }
  const ids = castIds(gladys, castId);
  const snapshot = device.snapshot;
  const media = snapshot?.online ? snapshot.media : null;
  const app = snapshot?.app && !snapshot.app.isIdleScreen ? snapshot.app : null;
  const statusItems = [
    { label: t('widget_state'), icon: 'activity', ...describeState(snapshot) },
    ...(app
      ? [
          {
            label: t('widget_app'),
            icon: 'cast',
            value: truncate(app.name, 40),
            color: WIDGET_COLORS.PRIMARY,
          },
        ]
      : []),
    ...(media?.title
      ? [
          {
            label: t('widget_title'),
            icon: 'music',
            value: truncate(media.title, 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ]
      : []),
    ...(media?.artist
      ? [
          {
            label: t('widget_artist'),
            icon: 'user',
            value: truncate(media.artist, 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ]
      : []),
  ];
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: truncate(device.name, 40),
    },
    // Live: follows the published volume state, no refresh involved.
    {
      type: 'value',
      label: t('widget_volume'),
      icon: 'volume-2',
      device_feature: ids.feature(MUSIC.VOLUME),
    },
  ];
  if (media?.artworkUrl) {
    components.push({
      type: 'image',
      key: gladys.artworkKey(media.artworkUrl),
      alt: media.title || device.name,
      fit: 'contain',
    });
  }
  components.push({ type: 'status', items: statusItems });
  if (snapshot?.online) {
    const playing = media?.playerState === 'PLAYING';
    components.push(
      // A device_feature button goes through onSetValue, like the core
      // controls of the device.
      {
        type: 'button',
        label: playing ? t('widget_pause') : t('widget_play'),
        icon: playing ? 'pause' : 'play',
        style: 'primary',
        device_feature: ids.feature(playing ? MUSIC.PAUSE : MUSIC.PLAY),
        value: 1,
      },
      {
        type: 'button',
        label: t('widget_next'),
        icon: 'skip-forward',
        style: 'secondary',
        device_feature: ids.feature(MUSIC.NEXT),
        value: 1,
      },
    );
    if (app) {
      components.push({
        type: 'button',
        label: t('widget_stop_casting'),
        icon: 'x-circle',
        style: 'danger',
        action: { key: ACTIONS.STOP_CASTING, params: { device: deviceExternalId }, confirm: true },
      });
    }
  }
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [OVERVIEW_WIDGET]: {
    async get(gladys, { manager }) {
      logger.debug(`onWidgetGet <- ${OVERVIEW_WIDGET}`);
      return overviewContent(manager);
    },
  },

  [PLAYER_WIDGET]: {
    // `settings.device` is the external_id the user picked (source: devices).
    async get(gladys, { manager, settings }) {
      logger.debug(`onWidgetGet <- ${PLAYER_WIDGET} (${settings?.device})`);
      return playerContent(gladys, manager, settings?.device);
    },

    // `params` come from the content above, never from user input.
    async action(gladys, { manager, actionKey, params }) {
      logger.info(`onWidgetAction <- ${PLAYER_WIDGET}.${actionKey}`);
      if (actionKey === ACTIONS.STOP_CASTING) {
        const stopped = await manager.controllerOf(params.device).stopApp();
        return stopped ? t('toast_stopped') : t('toast_nothing_casting');
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Ask the core to re-pull every widget now.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
