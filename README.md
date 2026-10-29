# Google Cast for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls **Google Cast** devices on the local network: Chromecast, Google Nest
speakers and displays, TVs with Chromecast built-in or Google TV, and speaker
groups. It replaces the Google Cast integration built into Gladys.

Built from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js)
and the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md)

## At a glance

|                     |                                                                                  |
| ------------------- | -------------------------------------------------------------------------------- |
| Connection          | **Local** only (`transports: ["local"]`): no Google account, no cloud, no key    |
| Countries / regions | **Worldwide**: no regional service behind Cast, no `countries` restriction       |
| Network zone        | Same LAN as Gladys (mDNS), or any routed subnet through manual IP addresses      |
| Discovery           | mDNS `_googlecast._tcp`, browsed by the Gladys core (`network_discovery`)        |
| Languages           | English, French, German, Spanish (manifest, messages, widgets, documentation)    |
| Gladys              | **5.3.0** or later                                                               |
| Catalog             | Categories `multimedia`, `notifications`                                         |
| Runtime             | Node.js 22+, one runtime dependency (the SDK), Cast v2 protocol implemented here |

### Where it is usable

- **Countries**: every country and region where Google Cast devices are sold.
  The protocol is local and the integration uses no online service, so the
  manifest declares no `countries` field — the catalog shows it everywhere.
- **Network zones**: the devices must be reachable from the Gladys host on
  TCP 8009 (and the 32xxx port of a speaker group). mDNS discovery covers the
  local network segment of Gladys; devices on another VLAN or subnet are added
  by their IP address. The Cast device must in turn reach the URLs it plays
  (the Gladys text-to-speech clips are served on the Gladys LAN address).
- **Remote use**: through Gladys (dashboard, scenes, Gladys Plus) from
  anywhere; the integration itself only talks to the local network.

## Compared with the built-in integration

| Feature                                   | Built-in | This integration  |
| ----------------------------------------- | :------: | :---------------: |
| mDNS discovery                            |    ✓     |         ✓         |
| Manual IP addresses (VLAN, other subnet)  |          |         ✓         |
| Speaker groups                            |    ✓     | ✓ (can be hidden) |
| Text-to-speech announcements              |    ✓     |         ✓         |
| Announcement volume, restored afterwards  |    ✓     |         ✓         |
| Now playing (title, artist, artwork…)     |          |         ✓         |
| Volume, mute, play / pause / next / seek  |          |         ✓         |
| Live state pushed by the device           |          |         ✓         |
| Local / unreachable badge, auto-reconnect |          |         ✓         |
| Scene triggers and scene actions          |          |         ✓         |
| Dashboard widgets                         |          |         ✓         |
| Stable ids (Cast UUID, not the name)      |          |         ✓         |

## Capabilities

| Surface              | Key                    | What it does                                                         |
| -------------------- | ---------------------- | -------------------------------------------------------------------- |
| Device               | `cast:<uuid>`          | Music player: state, title, artist, album, artwork, volume, mute…    |
| Core scene action    | Play a notification    | Text-to-speech on the device, at the configured volume               |
| Scene trigger        | `playback_started`     | Playback starts / resumes / changes track — `title`, `artist`, `app` |
| Scene trigger        | `playback_stopped`     | Playback ends — `reason` (`finished`, `cancelled`…), `title`         |
| Scene trigger        | `app_launched`         | An app starts casting — `app`, `app_id`                              |
| Scene trigger        | `availability_changed` | Device online / offline — `status`                                   |
| Scene action         | `cast_media`           | Cast a URL (radio, sound, video, picture) → `played`                 |
| Scene action         | `play_sound`           | Short sound at a volume, previous volume restored → `played`         |
| Scene action         | `stop_casting`         | Quit the running app → `stopped`                                     |
| Scene action         | `launch_app`           | Open a Cast app by id → `launched`                                   |
| Widget               | `cast_overview`        | Every device: online, app, what plays                                |
| Widget               | `cast_player`          | One device: live volume, artwork, title, play / pause / next / stop  |
| Configuration action | `scan_network`         | Browse again, refresh the addresses                                  |
| Configuration action | `test_connection`      | Connect to a device, show its volume and app                         |

## Project structure

```
.
├─ index.js                          # SDK bootstrap: registerHandlers() + connect()
├─ src/
│  ├─ app.js                         # every SDK handler, wired to the manager
│  ├─ manager.js                     # discovery, connections, states, scene events
│  ├─ cast/
│  │  ├─ protocol.js                 # Cast v2 framing + protobuf codec
│  │  ├─ client.js                   # one TLS connection: heartbeat, requests
│  │  ├─ controller.js               # one device: state, reconnection, commands
│  │  ├─ discovery.js                # mDNS answers, manual addresses
│  │  └─ media.js                    # LOAD payloads, MEDIA_STATUS reading
│  ├─ devices/castDevice.js          # the Gladys device and its external ids
│  ├─ scenes.js                      # scene actions
│  ├─ widgets.js                     # dashboard widgets
│  ├─ actions.js                     # Configuration screen buttons
│  ├─ artwork.js                     # artwork bytes for the player widget
│  ├─ i18n.js                        # en / fr / de / es messages
│  └─ config.js                      # config defaults + normalization
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Cast devices, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · SECURITY.md · CLAUDE.md
└─ cover.png                         # catalog cover, 800×534 px
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="google-cast" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test: protocol, devices, scenes, widgets, manifest
```

The tests run the real wiring (`src/app.js`) against the fake Gladys of the SDK
and in-memory Cast devices (`test/helpers/`): no network, no hardware. The CI
runs the same checks on Node 22 and 24 and builds the Docker image. Before a
release, the store validator checks everything the indexer will:

```bash
npx github:GladysAssistant/integration-store .
```

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`: the
   workflow bumps `package.json` and the manifest, rolls the changelog, tags,
   builds the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/gboulvin/gladys-google-cast` and publishes the GitHub Release.

The first version is already numbered `1.0.0` in `package.json` and the
manifest: publish it with `git tag v1.0.0 && git push --tags` (the hand-pushed
tag builds the image and the Release without bumping).

The repository needs the GitHub topic `gladys-assistant-integration` to be
indexed by the store, and **Private vulnerability reporting** turned on in the
security settings ([`SECURITY.md`](SECURITY.md) sends reporters there).

## License

Apache-2.0
