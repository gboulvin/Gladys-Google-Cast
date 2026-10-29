# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

The **Google Cast** external integration of Gladys Assistant: a Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It replaces the Google Cast integration built into
Gladys. It started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js).

Local only (`"transports": ["local"]`): the Cast devices are discovered by mDNS
through the Gladys core (`network_discovery`, `gladys.scanNetwork('mdns')`) and
driven over the Cast v2 protocol (TLS, port 8009), implemented in `src/cast/`
without any third-party library. Usable worldwide: the manifest declares no
`countries`.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/manager.test.js          # one file
node --test --test-name-pattern "widget"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     creates the SDK client, registerHandlers(), connect()
src/app.js                   every SDK handler, wired to the manager (tested as is)
src/manager.js               CastManager: discovery, one controller per CREATED device,
                             states / transports / scene events / widget nudges, commands
src/cast/protocol.js         Cast v2 wire format: framing + protobuf CastMessage codec
src/cast/client.js           CastClient: one TLS connection, heartbeat, requestId matching
src/cast/controller.js       CastController: one device kept connected, its state, commands
src/cast/discovery.js        mDNS answers and manual addresses -> Cast records
src/cast/media.js            LOAD payloads, MEDIA_STATUS reading, content types
src/devices/castDevice.js    the Gladys device (music features) and its external ids
src/scenes.js                scene action handlers (manifest `scene_actions`)
src/widgets.js               dashboard widgets (manifest `widgets`)
src/actions.js               Configuration screen buttons (manifest `actions`)
src/artwork.js               artwork bytes for the player widget (300 KB cap)
src/i18n.js                  user-facing texts of the code, en / fr / de / es
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
gladys-assistant-integration.json   the manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (en and fr mandatory)
test/                        node --test; test/helpers/ holds a fake Cast device and network
```

## Rules

- **External ids are forever.** Devices are `gladys.externalIds('cast', <castId>)`,
  `castId` being the mDNS `id` TXT record (the Cast UUID, lowercase hex) or
  `manual-<host>-<port>` for a typed address. Feature ids are
  `<device>:<music feature type>` — the convention of `publishNowPlaying`.
  Never change them: Gladys keys devices, history, scenes and dashboards on
  them. The same goes for every key users store: manifest `config_schema`,
  `actions`, widget, scene trigger / action keys and their field keys.
- **Push, never poll.** Devices are published with `should_poll: false`; the
  state comes from RECEIVER_STATUS / MEDIA_STATUS through `publishNowPlaying`,
  which only sends what changed.
- **Only created devices are connected.** Discovery publishes every device
  found; `syncControllers()` connects to the ones in `gladys.devices`.
- **No loops.** What the integration starts itself (scene actions,
  announcements) fires no scene event (`isOwnMedia`, `isOwnLaunch`).
- **Scene actions return outputs, they do not fail** on an unreachable
  device; only an invalid input (URL, app id) throws.
- **The container rootfs is read-only.** Write only under `/data` (the
  integration currently writes nothing). Never log tokens; media URLs only at
  debug level.
- **Tests never touch the network.** Use `test/helpers/fakeCastDevice.js`
  (a Cast device over an in-memory socket) and `createCastNetwork()` (the fake
  Gladys of the SDK + fake devices, through the real `registerHandlers`).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Four languages.** Every user-facing text exists in English, French,
  German and Spanish: manifest texts (`label`, `description`, `placeholder`,
  never a plain string), the messages of `src/i18n.js`, and `docs/*.md`, kept
  in sync. `test/manifest.test.js` fails on a missing language.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language, widget labels 3 to 30. `gladys_version` stays `>=5.3.0` at least
  (`music`, `keywords`: 5.3.0; `widgets`, `scene_*`: 5.1.0). The tests tie the
  manifest to the code (defaults, action, scene, trigger and widget keys):
  change both sides together.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.
