# EMP-1715 audio and movie protocol notes

## Audio paths

The EMP-1715 has two different audio paths:

1. ESC/VP.net controls volume, combined A/V mute, and internal/external audio
   output.
2. EasyMP movie playback transfers an MPEG transport stream, including its
   audio, directly to one projector.

Normal EasyMP desktop projection uses EPRD JPEG tiles and does not carry audio.
Movie playback is therefore implemented as a separate transport rather than as
an extension of `EasyMPVideo`.

## Captured movie protocol

The following exchange was captured from the official EasyMP client and an
EMP-1715:

1. Send broadcast type `0x01` and direct type `0x02` discovery packets over
   UDP 3620. Both contain a 48-byte zero payload.
2. Read the projector's type `0x03` discovery response and retain its four-byte
   device ID.
3. Send type `0x04` and accept the projector's reverse TCP control connection
   on port 3620. The projector starts it with type `0x05`.
4. Keep the control connection alive with type `0x0a` and open the normal,
   otherwise idle EPRD channel to the projector on TCP 3621.
5. Open a TCP listener on sender port 50020.
6. Send EEMP control type `0x13`. Its 48-byte payload contains four zero bytes,
   the sender's IPv4 address, the listener port as a big-endian 16-bit integer,
   and 38 zero bytes.
7. The projector connects back to that listener and sends `GET / HTTP/1.0`.
8. Reply with `HTTP/1.0 200 OK`, an `application/octet-stream` content type,
   `Cache-Control: no-cache`, and `X-vsfb-status: play`.
9. Stream MPEG-TS bytes until end of file.
10. Close the HTTP connection to finish playback. No separate movie-stop control
   packet was observed.
11. Keep the EEMP control connection alive during playback and disconnect it
   afterward as usual.

Observed stream values:

- MPEG-TS transport-stream ID: `0x655a` (25946)
- PMT PID: `0x42`
- MPEG-2 video PID: `0x44`, Main Profile at Main Level, 320x240, 30 fps,
  YUV 4:2:0, approximately 7.808 Mbit/s
- MPEG-1 Layer II audio PID: `0x45`, 48 kHz stereo, 192 kbit/s
- Total mux rate: approximately 8.288 Mbit/s

`EasyMPMovie.play()` asks ffmpeg to produce this profile. ffmpeg additionally
emits SDT and null packets that were absent from the captured official stream;
the EMP-1715 accepted these packets during the hardware playback test.

## Official input constraints

The EMP-1715 documentation describes these movie-file constraints for the
official EasyMP client:

- MPEG program stream with an `.mpg` extension
- MPEG-2 video, at most 720x576 and 30 fps
- MPEG-1 Layer I or Layer II audio
- Linear PCM and AC-3 are unsupported
- WMV/ASF with WMV8 or WMV9 video and WMA audio is also supported by the
  official client
- Movie playback targets one projector at a time

The library accepts any input that the installed ffmpeg can decode, then emits
the captured MPEG-TS profile. `playTransportStream()` bypasses that conversion
and should only be used with a compatible pre-encoded stream.

Packet captures can contain unrelated private network traffic and should not be
published without review.
