# Universal Remote for Homey

Universal Remote creates virtual remote-control devices in Homey. Buttons can be learned through an ESPHome/MQTT receiver or entered manually as ProntoHex/raw timings. Learned commands are converted into regular Homey infrared frames and sent through the Homey Bridge selected for each virtual remote.

## How transmission works

Homey cannot route arbitrary runtime ProntoHex directly through a Bridge. Universal Remote therefore converts each stored command into a frame whose entries reference one of the static timing codebooks in `.homeycompose/signals/ir`.

The production codebooks use a 32 x 32 Cartesian timing matrix (1024 words) with logarithmically distributed durations from 5 to 32767 microseconds. Carrier profiles are available every 2 kHz from 30 to 58 kHz and the nearest profile is selected automatically.

A button may contain either one legacy ProntoHex/raw frame or a timed sequence of multiple frames. Sequence frames are transmitted in order through the same Homey device so Bridge/satellite routing remains unchanged.

## Learning

Learning uses MQTT topics shared with an ESPHome receiver. Homey collects five complete button presses rather than treating every decoded Pronto message as a separate attempt. Frames received within one press are grouped into a sequence; corresponding frame positions from repeated presses are compared using the timing consensus logic. This preserves multi-frame commands such as a full command followed by repeat frames without requiring protocol-specific decoding.

ProntoHex and raw timing arrays can also be entered manually, so the learning gateway is optional when a compatible code is already known. In the Repair editor, put one frame per line and use `@delay <ms>` after a frame when a multi-frame sequence needs an explicit pause.

See `docs/esphome-mqtt.md` for the MQTT protocol and the example ESPHome firmware in `esp8285_firmware/`.

## Device backups

Backups are intentionally per remote. Open a remote's Repair view, export its JSON into the shared backup text field and copy it wherever you want to keep it. To restore a backup, paste the JSON into the same field and import it. The current Homey device identity and selected Bridge remain intact.

## Development

```bash
npm test
npm run lint
npm run homey:validate
npm run homey:build
npm run homey:run
```

Before publishing a release, run:

```bash
npm run homey:validate:publish
```

or use the complete publishing command:

```bash
npm run homey:publish
```

`scripts/generate-ir-codebooks.js` is a maintenance tool for regenerating the tracked production codebooks after changing the timing grid or carrier buckets.

## Encoding limits

Regular Homey infrared signal timings are limited to 5..32767 microseconds. The encoder quantizes mark and space durations independently and rejects a timing when the codebook error would exceed 20%. A terminal space longer than 32767 microseconds is clamped because transmission ends in silence anyway; oversized spaces inside a frame are rejected instead of silently changing protocol timing.
