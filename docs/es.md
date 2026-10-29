# Google Cast

Controle sus dispositivos Google Cast desde Gladys: Chromecast, altavoces y
pantallas Google Nest (Nest Mini, Nest Audio, Nest Hub...), televisores con
Chromecast integrado o Google TV, y los grupos de altavoces de la aplicación
Google Home.

Todo ocurre en su **red local**: sin cuenta de Google, sin nube, sin clave de
API. Esta integración sustituye a la integración Google Cast incluida en
Gladys, con mucho más que anuncios.

## Dónde funciona

- **Países**: en todas partes. Google Cast es un protocolo local, sin ningún
  servicio regional detrás: la integración funciona en todos los países y
  regiones donde se venden dispositivos Cast, sea cual sea el idioma del
  dispositivo.
- **Red**: Gladys y los dispositivos Cast deben compartir la misma red local.
  El descubrimiento usa mDNS (como su teléfono), que no atraviesa routers: un
  dispositivo en otra VLAN o subred puede añadirse igualmente por su
  dirección IP (vea _Direcciones manuales_), siempre que Gladys pueda
  alcanzarlo en el puerto TCP 8009 (y 32000-33000 para los grupos de
  altavoces).
- **Desde fuera de casa**: los dispositivos Cast solo son accesibles desde su
  red doméstica, pero Gladys también — el panel, las escenas y Gladys Plus
  funcionan desde cualquier lugar, Gladys transmite los comandos en local.

Requiere Gladys Assistant **5.3.0 o posterior**.

## Lo que obtiene

Cada dispositivo Cast se convierte en un reproductor de música en Gladys, con:

- la **tarjeta «Reproduciendo»** del panel: título, artista, álbum, carátula,
  progreso, reproducir / pausa / anterior / siguiente, sea cual sea la
  aplicación que transmite (Spotify, YouTube Music, Deezer, una radio web...);
- el **volumen** y el **silencio**, sincronizados cuando alguien los cambia
  desde un teléfono o desde el propio dispositivo;
- los **anuncios**: la acción de escena «Reproducir una notificación» de
  Gladys habla en el dispositivo (síntesis de voz);
- una insignia **local** en el dispositivo, en rojo cuando el dispositivo es
  inaccesible.

La integración mantiene una conexión abierta con cada dispositivo añadido:
cada cambio lo envía el dispositivo, nada se consulta periódicamente.

## Instalación y configuración

1. Instale **Google Cast** desde el catálogo de integraciones.
2. Abra la pestaña **Descubrimiento**: aparecen los dispositivos Cast de su
   red. Añada los que quiera. Los grupos de altavoces también aparecen.
3. Eso es todo. La pestaña **Configuración** ofrece algunas opciones:
   - **Direcciones manuales**: las direcciones IP de los dispositivos que el
     descubrimiento no encuentra (otra VLAN), separadas por comas, p. ej.
     `192.168.20.15, 192.168.20.16:8009`. Asigne a estos dispositivos una
     dirección fija en su router: la dirección los identifica.
   - **Grupos de altavoces**: desmarque para ocultar los grupos de altavoces.
   - **Volumen de los anuncios**: el volumen de los anuncios de Gladys, de 1
     a 100 %; después vuelve el volumen anterior. `0` mantiene el volumen
     actual.
   - **Duración de la búsqueda**: auméntela si faltan dispositivos en la
     pestaña Descubrimiento.

Botones de la pestaña Configuración:

- **Buscar en la red**: vuelve a encontrar los dispositivos (los nuevos van a
  la pestaña Descubrimiento) y actualiza las direcciones de los conocidos.
- **Probar un dispositivo**: se conecta al dispositivo elegido y muestra su
  volumen y la aplicación en curso.

Un dispositivo cuya dirección ha cambiado (nueva concesión DHCP) se vuelve a
encontrar automáticamente tras algunos intentos de conexión fallidos.

## Escenas

### Disparadores

En el editor de escenas, en la categoría de la integración:

- **Reproducción Cast iniciada**: algo empieza o reanuda la reproducción, o
  cambia la pista. Variables: `title`, `artist`, `app`.
- **Reproducción Cast detenida**: el medio terminó, se detuvo, se interrumpió
  o falló. Filtre por el motivo si lo desea. Variables: `reason` (`finished`,
  `cancelled`, `interrupted`, `error`), `title`.
- **Aplicación Cast iniciada**: una aplicación empieza a transmitir (YouTube,
  Netflix, Spotify...). Filtre por su nombre exacto si lo desea. Variables:
  `app`, `app_id`.
- **Dispositivo Cast en línea / sin conexión**: un dispositivo pasa a estar
  accesible o inaccesible. Variable: `status` (`online`, `offline`).

Cada disparador puede limitarse a un dispositivo; si se deja vacío, cualquier
dispositivo coincide. Las variables se leen con `{{triggerEvent.data.title}}`
en las acciones siguientes. Lo que la propia integración transmite (acciones
de escena, anuncios) nunca activa estos disparadores: una escena no puede
entrar en bucle.

El volumen y el estado de reproducción también son funciones del
dispositivo: el disparador estándar «Estado de un dispositivo» funciona con
ellos («cuando la TV está en pausa...»).

### Acciones

- **Transmitir un medio**: reproduce una URL en un dispositivo: una radio web,
  un sonido, un vídeo, una imagen (p. ej. la captura de una cámara). Elija el
  formato o deje que la integración lo deduzca de la URL; marque _Emisión en
  directo_ para una radio web. Salida: `played`.
- **Reproducir un sonido**: reproduce un sonido corto (timbre, alarma) al
  volumen elegido y luego restaura el volumen anterior. Salida: `played`.
- **Detener la transmisión**: cierra la aplicación que transmite al
  dispositivo. Salida: `stopped` (falso si no se transmitía nada).
- **Iniciar una aplicación Cast**: abre una aplicación a partir de su id.
  Cast, p. ej. `233637DE` (YouTube). Salida: `launched`.

La URL debe ser accesible para el propio dispositivo Cast (una URL pública o
una dirección de su red local). Un dispositivo inaccesible no detiene la
escena: la salida vale `false`, úsela en una condición si es necesario.

Las acciones estándar de Gladys también funcionan: **Reproducir una
notificación** (síntesis de voz), **Controlar un dispositivo** (volumen,
silencio, estado de reproducción).

## Panel

- La tarjeta **Música** de Gladys muestra cualquier dispositivo Cast, con su
  carátula y sus controles.
- Widget **Dispositivos Google Cast**: todos los dispositivos de un vistazo
  (en línea, aplicación que transmite, lo que suena).
- Widget **Reproductor Google Cast**: un dispositivo, su volumen en directo,
  la carátula, el título y el artista, y los botones reproducir / pausa,
  siguiente y parar.

## Migrar desde la integración Google Cast incluida

Los dispositivos de esta integración son dispositivos nuevos de Gladys:

1. Añada los dispositivos desde la pestaña Descubrimiento de esta
   integración.
2. En sus escenas, apunte las acciones **Reproducir una notificación** a los
   nuevos dispositivos y actualice sus paneles.
3. Elimine los dispositivos de la integración incluida (Integraciones →
   Google Cast → Dispositivos).

## Solución de problemas

- **Ningún dispositivo en la pestaña Descubrimiento**: los dispositivos deben
  estar en la misma red que Gladys. Compruebe que aparecen en la aplicación
  Google Home en la misma Wi-Fi, aumente la duración de la búsqueda o use las
  direcciones manuales.
- **Insignia inaccesible**: el dispositivo está apagado o su dirección ha
  cambiado. Use **Buscar en la red** y luego **Probar un dispositivo**.
- **Sin sonido en los anuncios**: el dispositivo Cast descarga el mensaje de
  voz desde Gladys: debe poder alcanzar la dirección de Gladys en su red.
- **No pasa nada con siguiente / anterior**: algunas aplicaciones (YouTube,
  Netflix) no aceptan estos comandos desde otro emisor.

Registros: Integraciones → Google Cast → Registros. Ponga la variable de
entorno `LOG_LEVEL` en `debug` para ver todo el detalle.

## Privacidad y seguridad

La integración solo se comunica con los dispositivos Cast de su red local
(conexión cifrada TLS, puerto 8009) y, para las carátulas del panel, con los
servidores de imágenes de las aplicaciones que transmiten. Ningún otro dato
sale de su casa. Consulte
[SECURITY.md](https://github.com/gboulvin/Gladys-Google-Cast/blob/main/SECURITY.md)
para informar de una vulnerabilidad.
