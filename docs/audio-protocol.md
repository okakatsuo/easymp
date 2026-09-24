# EMP-1715 audio protocol notes

## Confirmed capabilities

The EMP-1715 has two different audio paths:

1. ESC/VP.net controls volume, A/V mute, and internal/external audio output.
2. EasyMP movie playback transfers a supported movie file, including its audio,
   directly to one projector.

Normal EasyMP desktop projection does not transfer audio. Therefore audio
cannot be added to the existing EPRD JPEG tile stream without implementing the
separate movie playback protocol.

## Official movie constraints

- MPEG program stream: `.mpg` only
- Video: MPEG-2, at most 720x576 and 30 fps
- Audio: MPEG-1 Layer 1 or Layer 2
- Linear PCM and AC-3 are unsupported
- WMV/ASF with WMV8 or WMV9 video and WMA audio are also supported
- Movie playback targets one projector at a time

## Capture plan

Capture two otherwise identical five-second MPEG files in EasyMP movie playback
mode:

1. black video with a 440 Hz MPEG Layer 2 tone;
2. black video with silence.

Start capture before entering movie playback mode, play the whole file, exit
movie playback, then stop capture. Restrict capture to the projector host but
keep TCP ports 3620, 3621, and 3629. Comparing these traces isolates the movie
mode handshake and the audio-bearing payload from the known desktop EPRD
traffic.

Do not publish packet captures without checking them for unrelated private
network traffic.
