# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-19

### Added

- Optional `fullFrameInterval` for resending the full image on a subsequent `display.update()`.
- Wireshark analysis comparing the EMP-1715 session with LibreMP's iProjection capture.

### Fixed

- Stop discovery retries as soon as the projector responds and calculate the subnet broadcast address from the interface netmask.
- Reassemble fragmented TCP control packets, accept callbacks from the configured projector, and wait for the projector's disconnect acknowledgement.
- Serialize display connection and frame operations and bind the video channel to the same local interface as the control channel.

## [0.2.0] - 2026-09-24

### Added

- EMP-1715 volume, audio output, and A/V mute controls through ESC/VP.net.
- Optional local-address binding for ESC/VP.net in multi-interface environments.
- EMP-1715 EasyMP movie-mode playback with ffmpeg transcoding and audio.
- Direct playback of pre-encoded EasyMP-compatible MPEG transport streams.

### Fixed

- Send the complete 16-byte ESC/VP.net handshake instead of a truncated byte.
- Match the captured EasyMP discovery, connection, and movie-start packet layouts.
- Open the idle EPRD channel required before entering EMP-1715 movie mode.

## [0.1.0] - 2026-09-24

### Added

- ESC/VP.net power control and status queries.
- EasyMP session bootstrap and keepalive support verified with an EMP-1715.
- EPRD JPEG tile packet generation and video transport.
- Full-frame image tiling and changed-tile updates.
- Bun and Node.js ESM package builds with TypeScript declarations.

[Unreleased]: https://github.com/okakatsuo/easymp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/okakatsuo/easymp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/okakatsuo/easymp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/okakatsuo/easymp/releases/tag/v0.1.0
