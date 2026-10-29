# Google Cast

Steuern Sie Ihre Google-Cast-Geräte mit Gladys: Chromecast, Google-Nest-
Lautsprecher und -Displays (Nest Mini, Nest Audio, Nest Hub ...), Fernseher mit
integriertem Chromecast oder Google TV sowie die Lautsprechergruppen der
Google-Home-App.

Alles läuft in Ihrem **lokalen Netzwerk**: kein Google-Konto, keine Cloud,
kein API-Schlüssel. Diese Integration ersetzt die in Gladys eingebaute
Google-Cast-Integration und kann weit mehr als Ansagen.

## Wo sie funktioniert

- **Länder**: überall. Google Cast ist ein lokales Protokoll ohne regionalen
  Dienst dahinter: Die Integration funktioniert in allen Ländern und Regionen,
  in denen Cast-Geräte verkauft werden, unabhängig von der Sprache des Geräts.
- **Netzwerk**: Gladys und die Cast-Geräte müssen im selben lokalen Netzwerk
  sein. Die Erkennung nutzt mDNS (wie Ihr Smartphone), das keine Router
  überquert: Ein Gerät in einem anderen VLAN oder Subnetz lässt sich trotzdem
  über seine IP-Adresse hinzufügen (siehe _Manuelle Adressen_), sofern Gladys
  es über TCP-Port 8009 erreicht (und 32000-33000 für Lautsprechergruppen).
- **Von unterwegs**: Die Cast-Geräte sind nur aus Ihrem Heimnetz erreichbar,
  Gladys aber auch — Dashboard, Szenen und Gladys Plus funktionieren überall,
  Gladys leitet die Befehle lokal weiter.

Erfordert Gladys Assistant **5.3.0 oder neuer**.

## Was Sie bekommen

Jedes Cast-Gerät wird in Gladys zu einem Musikplayer mit:

- der **„Wird gerade abgespielt“-Karte** im Dashboard: Titel, Interpret,
  Album, Cover, Fortschritt, Play / Pause / Zurück / Weiter, egal welche App
  streamt (Spotify, YouTube Music, Deezer, ein Webradio ...);
- **Lautstärke** und **Stummschaltung**, synchron gehalten, wenn jemand sie am
  Smartphone oder am Gerät selbst ändert;
- **Ansagen**: Die Gladys-Szenenaktion „Benachrichtigung abspielen“ spricht
  auf dem Gerät (Sprachausgabe);
- einem **lokalen** Badge am Gerät, rot, wenn das Gerät nicht erreichbar ist.

Die Integration hält zu jedem hinzugefügten Gerät eine Verbindung offen: Jede
Änderung wird vom Gerät gemeldet, nichts wird abgefragt.

## Installation und Konfiguration

1. Installieren Sie **Google Cast** aus dem Integrationskatalog.
2. Öffnen Sie den Tab **Erkennung**: Die Cast-Geräte Ihres Netzwerks werden
   aufgelistet. Fügen Sie die gewünschten hinzu. Auch die
   Lautsprechergruppen erscheinen.
3. Fertig. Der Tab **Konfiguration** bietet einige Optionen:
   - **Manuelle Adressen**: die IP-Adressen der Geräte, die die Erkennung
     nicht findet (anderes VLAN), durch Kommas getrennt, z. B.
     `192.168.20.15, 192.168.20.16:8009`. Vergeben Sie diesen Geräten im
     Router eine feste Adresse: Die Adresse identifiziert sie.
   - **Lautsprechergruppen**: abwählen, um die Lautsprechergruppen
     auszublenden.
   - **Lautstärke der Ansagen**: die Lautstärke der Gladys-Ansagen, von 1 bis
     100 %; danach wird die vorherige Lautstärke wiederhergestellt. `0`
     behält die aktuelle Lautstärke.
   - **Suchdauer**: erhöhen, wenn Geräte im Tab „Erkennung“ fehlen.

Schaltflächen im Tab „Konfiguration“:

- **Netzwerk durchsuchen**: findet die Geräte erneut (neue erscheinen im Tab
  „Erkennung“) und aktualisiert die Adressen der bekannten.
- **Gerät testen**: verbindet sich mit dem gewählten Gerät und zeigt seine
  Lautstärke und die laufende App.

Ein Gerät mit geänderter Adresse (neue DHCP-Zuweisung) wird nach einigen
fehlgeschlagenen Verbindungen automatisch wiedergefunden.

## Szenen

### Auslöser

Im Szeneneditor, in der Kategorie der Integration:

- **Cast-Wiedergabe gestartet**: Eine Wiedergabe startet oder wird
  fortgesetzt, oder der Titel wechselt. Variablen: `title`, `artist`, `app`.
- **Cast-Wiedergabe gestoppt**: Das Medium ist zu Ende, wurde gestoppt,
  unterbrochen oder ist fehlgeschlagen. Auf Wunsch nach Grund filtern.
  Variablen: `reason` (`finished`, `cancelled`, `interrupted`, `error`),
  `title`.
- **Cast-App gestartet**: Eine App beginnt zu streamen (YouTube, Netflix,
  Spotify ...). Auf Wunsch nach ihrem genauen Namen filtern. Variablen:
  `app`, `app_id`.
- **Cast-Gerät online / offline**: Ein Gerät wird erreichbar oder
  unerreichbar. Variable: `status` (`online`, `offline`).

Jeder Auslöser lässt sich auf ein Gerät beschränken; leer gelassen, passt
jedes Gerät. Die Variablen werden in den folgenden Aktionen mit
`{{triggerEvent.data.title}}` gelesen. Was die Integration selbst streamt
(Szenenaktionen, Ansagen), löst diese Auslöser nie aus: Eine Szene kann
nicht in eine Schleife geraten.

Lautstärke und Wiedergabestatus sind auch Gerätefunktionen: Der
Standardauslöser „Gerätezustand“ funktioniert damit („wenn der Fernseher
pausiert ...“).

### Aktionen

- **Medium streamen**: spielt eine URL auf einem Gerät ab: ein Webradio, einen
  Ton, ein Video, ein Bild (z. B. ein Kamerabild). Wählen Sie das Format oder
  lassen Sie die Integration es anhand der URL erraten; aktivieren Sie
  _Livestream_ für ein Webradio. Ausgabe: `played`.
- **Ton abspielen**: spielt einen kurzen Ton (Türgong, Alarm) mit der
  gewählten Lautstärke und stellt danach die vorherige Lautstärke wieder her.
  Ausgabe: `played`.
- **Streaming stoppen**: beendet die App, die auf das Gerät streamt. Ausgabe:
  `stopped` (falsch, wenn nichts gestreamt wurde).
- **Cast-App starten**: öffnet eine App über ihre Cast-App-ID, z. B.
  `233637DE` (YouTube). Ausgabe: `launched`.

Die URL muss für das Cast-Gerät selbst erreichbar sein (eine öffentliche URL
oder eine Adresse Ihres lokalen Netzwerks). Ein unerreichbares Gerät hält die
Szene nicht an: Die Ausgabe ist `false`, nutzen Sie sie bei Bedarf in einer
Bedingung.

Die Standardaktionen von Gladys funktionieren ebenfalls:
**Benachrichtigung abspielen** (Sprachausgabe), **Gerät steuern**
(Lautstärke, Stummschaltung, Wiedergabestatus).

## Dashboard

- Die **Musik**-Karte von Gladys zeigt jedes Cast-Gerät mit Cover und
  Bedienelementen.
- Widget **Google-Cast-Geräte**: alle Geräte auf einen Blick (online,
  streamende App, laufende Wiedergabe).
- Widget **Google-Cast-Player**: ein Gerät, seine Live-Lautstärke, das
  Cover, Titel und Interpret sowie die Schaltflächen Play / Pause, Weiter und
  Stopp.

## Umstieg von der eingebauten Google-Cast-Integration

Die Geräte dieser Integration sind neue Gladys-Geräte:

1. Fügen Sie die Geräte im Tab „Erkennung“ dieser Integration hinzu.
2. Richten Sie in Ihren Szenen die Aktionen **Benachrichtigung abspielen**
   auf die neuen Geräte aus und aktualisieren Sie Ihre Dashboards.
3. Löschen Sie die Geräte der eingebauten Integration (Integrationen →
   Google Cast → Geräte).

## Fehlerbehebung

- **Kein Gerät im Tab „Erkennung“**: Die Geräte müssen im selben Netzwerk wie
  Gladys sein. Prüfen Sie, ob sie in der Google-Home-App im selben WLAN
  erscheinen, erhöhen Sie die Suchdauer oder nutzen Sie die manuellen
  Adressen.
- **Badge „nicht erreichbar“**: Das Gerät ist aus oder seine Adresse hat sich
  geändert. Nutzen Sie **Netzwerk durchsuchen**, dann **Gerät testen**.
- **Kein Ton bei Ansagen**: Das Cast-Gerät lädt die Sprachnachricht von
  Gladys herunter: Es muss die Adresse von Gladys in Ihrem Netzwerk
  erreichen können.
- **Nichts passiert bei Weiter / Zurück**: Manche Apps (YouTube, Netflix)
  akzeptieren diese Befehle nicht von einem anderen Sender.

Logs: Integrationen → Google Cast → Logs. Setzen Sie die Umgebungsvariable
`LOG_LEVEL` auf `debug` für alle Details.

## Datenschutz und Sicherheit

Die Integration spricht nur mit den Cast-Geräten Ihres lokalen Netzwerks
(verschlüsselte TLS-Verbindung, Port 8009) und, für die Cover im Dashboard,
mit den Bildservern der streamenden Apps. Sonst verlassen keine Daten Ihr
Zuhause. Siehe
[SECURITY.md](https://github.com/gboulvin/Gladys-Google-Cast/blob/main/SECURITY.md),
um eine Sicherheitslücke zu melden.
