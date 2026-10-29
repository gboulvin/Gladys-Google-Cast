# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-29

### Added

- First version of the Google Cast external integration, replacing the
  integration built into Gladys (Gladys 5.3.0 or later).
- Discovery of Chromecast, Google Nest speakers and displays, TVs with
  Chromecast built-in and speaker groups by mDNS through the Gladys core, plus
  manual IP addresses for the networks mDNS does not cross.
- A music player per device: playback state, title, artist, album, artwork,
  duration and position for the "now playing" card, with volume, mute,
  play / pause / previous / next and seek, all pushed live by the device.
- Gladys announcements ("Play a notification" scene action) at a configurable
  volume, the previous volume restored afterwards.
- Scene triggers: playback started, playback stopped (with its reason), app
  launched, device online / offline.
- Scene actions: cast a media URL, play a sound, stop casting, launch a Cast
  app.
- Dashboard widgets: an overview of every Cast device, and a player for one
  device with its artwork and controls.
- Configuration actions: search the network, test a device.
- A "local" transport badge per device, "unreachable" when it is off.
- Texts and documentation in English, French, German and Spanish.
- `SECURITY.md` (how to report a vulnerability, security model) and
  `CLAUDE.md` (project rules for contributors and coding assistants).

[Unreleased]: https://github.com/gboulvin/Gladys-Google-Cast/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/Gladys-Google-Cast/releases/tag/v1.0.0
