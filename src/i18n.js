// -----------------------------------------------------------------------------
// User-facing texts of the code, in the four languages of the integration
// (English, French, German, Spanish). Gladys picks the user's language from
// the multi-language object and falls back to English.
//
// The manifest texts live in gladys-assistant-integration.json; the tests
// check that both carry the four languages.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const MESSAGES = {
  init_failed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, prüfen Sie die Logs der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  device_unknown: {
    en: 'This device is not a Google Cast device of this integration.',
    fr: "Cet appareil n'est pas un appareil Google Cast de cette intégration.",
    de: 'Dieses Gerät ist kein Google-Cast-Gerät dieser Integration.',
    es: 'Este dispositivo no es un dispositivo Google Cast de esta integración.',
  },
  test_ok: {
    en: '{name} answers: volume {volume}%, {app}.',
    fr: '{name} répond : volume {volume} %, {app}.',
    de: '{name} antwortet: Lautstärke {volume} %, {app}.',
    es: '{name} responde: volumen {volume} %, {app}.',
  },
  test_failed: {
    en: '{name} does not answer: {error}',
    fr: '{name} ne répond pas : {error}',
    de: '{name} antwortet nicht: {error}',
    es: '{name} no responde: {error}',
  },
  app_running: {
    en: 'casting {app}',
    fr: 'diffuse {app}',
    de: 'streamt {app}',
    es: 'transmitiendo {app}',
  },
  app_none: {
    en: 'nothing is casting',
    fr: 'aucune diffusion',
    de: 'nichts wird gestreamt',
    es: 'nada se está transmitiendo',
  },
  scan_result: {
    en: '{count} Google Cast device(s) found. New ones are in the Discovery tab.',
    fr: '{count} appareil(s) Google Cast trouvé(s). Les nouveaux sont dans l’onglet Découverte.',
    de: '{count} Google-Cast-Gerät(e) gefunden. Neue Geräte stehen im Tab „Erkennung“.',
    es: '{count} dispositivo(s) Google Cast encontrado(s). Los nuevos están en la pestaña Descubrimiento.',
  },
  scan_invalid_hosts: {
    en: 'Ignored addresses: {hosts}.',
    fr: 'Adresses ignorées : {hosts}.',
    de: 'Ignorierte Adressen: {hosts}.',
    es: 'Direcciones ignoradas: {hosts}.',
  },
  // Widgets
  widget_volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  widget_state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  widget_app: { en: 'App', fr: 'Application', de: 'App', es: 'Aplicación' },
  widget_title: { en: 'Title', fr: 'Titre', de: 'Titel', es: 'Título' },
  widget_artist: { en: 'Artist', fr: 'Artiste', de: 'Interpret', es: 'Artista' },
  widget_play: { en: 'Play', fr: 'Lecture', de: 'Abspielen', es: 'Reproducir' },
  widget_pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  widget_next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  widget_stop_casting: {
    en: 'Stop casting',
    fr: 'Arrêter',
    de: 'Stoppen',
    es: 'Detener',
  },
  widget_no_device: {
    en: 'No Google Cast device yet: add them from the Discovery tab of the integration.',
    fr: "Aucun appareil Google Cast pour l'instant : ajoutez-les depuis l'onglet Découverte de l'intégration.",
    de: 'Noch kein Google-Cast-Gerät: Fügen Sie sie im Tab „Erkennung“ der Integration hinzu.',
    es: 'Aún no hay dispositivos Google Cast: añádalos desde la pestaña Descubrimiento de la integración.',
  },
  widget_device_missing: {
    en: 'This Google Cast device no longer exists: pick another one in the widget settings.',
    fr: "Cet appareil Google Cast n'existe plus : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Google-Cast-Gerät existiert nicht mehr: Wählen Sie in den Widget-Einstellungen ein anderes.',
    es: 'Este dispositivo Google Cast ya no existe: elija otro en los ajustes del widget.',
  },
  widget_online_count: {
    en: '{online} of {total} online',
    fr: '{online} sur {total} en ligne',
    de: '{online} von {total} online',
    es: '{online} de {total} en línea',
  },
  toast_stopped: {
    en: 'Casting stopped.',
    fr: 'Diffusion arrêtée.',
    de: 'Streaming gestoppt.',
    es: 'Transmisión detenida.',
  },
  toast_nothing_casting: {
    en: 'Nothing was casting.',
    fr: "Rien n'était diffusé.",
    de: 'Es wurde nichts gestreamt.',
    es: 'No se estaba transmitiendo nada.',
  },
  // Device states
  state_playing: { en: 'Playing', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  state_paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  state_buffering: { en: 'Loading', fr: 'Chargement', de: 'Lädt', es: 'Cargando' },
  state_idle: { en: 'Idle', fr: 'Inactif', de: 'Inaktiv', es: 'Inactivo' },
  state_offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
};

function interpolate(text, vars) {
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * The multi-language object of a message, with its `{placeholders}` filled.
 * A placeholder value may itself be a multi-language object: each language
 * then gets its own translation.
 * @param {keyof typeof MESSAGES} key
 * @param {Record<string, unknown>} [vars]
 * @returns {{ en: string, fr: string, de: string, es: string }}
 */
export function t(key, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message: ${key}`);
  }
  return Object.fromEntries(
    LANGUAGES.map((lang) => {
      const localVars = Object.fromEntries(
        Object.entries(vars).map(([name, value]) => [
          name,
          value !== null && typeof value === 'object' ? (value[lang] ?? value.en) : value,
        ]),
      );
      return [lang, interpolate(message[lang], localVars)];
    }),
  );
}

/** Every message key, for the tests. */
export const MESSAGE_KEYS = Object.keys(MESSAGES);
