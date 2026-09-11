# Homey IR Remote

Homey app for learning arbitrary IR codes through an ESPHome/MQTT receiver and transmitting them through the Homey Bridge selected for each virtual remote.

## Dynamic IR transmission

Homey cannot route runtime ProntoHex directly through a Bridge. The app therefore converts learned ProntoHex/raw timings into a regular Homey IR frame whose entries reference a static timing codebook.

The production codebook uses a 32 x 32 Cartesian timing matrix (1024 words) with logarithmically distributed durations from 5 to 32767 microseconds. Static carrier profiles are provided every 2 kHz from 30 to 58 kHz. The nearest carrier profile is selected automatically.

The 64, 256, 512 and 1024 word-index diagnostic signals are intentionally kept separate from the production codebooks. Physical tests confirmed correct Bridge output through word index 1023.

## Development

The carrier codebooks are checked into `.homeycompose/signals/ir`, so normal Homey commands work directly after a fresh clone:

```bash
homey app run --remote
```

Normal project checks remain available:

```bash
npm test
npm run lint
npm run homey:validate
npm run homey:build
npm run homey:run
```

`npm run homey:run` is simply an alias for `homey app run --remote`.

`scripts/generate-ir-codebooks.js` is a maintenance tool. Run:

```bash
npm run generate:ir-codebooks
```

only when changing the timing grid or carrier buckets, then commit the regenerated `dynamic_codebook_*.json` files. The generator writes the tracked files deterministically so an unchanged codebook definition does not create formatting-only diffs.

## Encoding limits

Regular Homey IR signal timings are limited to 5..32767 microseconds. The encoder quantizes each mark and space independently and rejects a timing when the codebook error would exceed 20%. A terminal space longer than 32767 microseconds is clamped because transmission ends in silence anyway; oversized spaces inside a frame are rejected rather than silently changing protocol timing.

Pronto repeat sections are preserved when a button requests multiple repetitions. Raw codes without a separate repeat section use Homey's native signal repetition support.
