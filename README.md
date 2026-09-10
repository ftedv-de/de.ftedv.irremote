# Homey IR Remote

Homey app for learning arbitrary IR codes through an ESPHome/MQTT receiver and transmitting them through the Homey Bridge selected for each virtual remote.

## Dynamic IR transmission

Homey cannot route runtime ProntoHex directly through a Bridge. The app therefore converts learned ProntoHex/raw timings into a regular Homey IR frame whose entries reference a static timing codebook.

The production codebook uses a 32 x 32 Cartesian timing matrix (1024 words) with logarithmically distributed durations from 5 to 32767 microseconds. Carrier profiles are generated every 2 kHz from 30 to 58 kHz. The nearest carrier profile is selected automatically.

The 64, 256, 512 and 1024 word-index diagnostic signals are intentionally kept separate from the production codebooks. Physical tests confirmed correct Bridge output through word index 1023.

## Development

Generate the carrier codebooks before Homey preprocessing:

```bash
npm run generate:ir-codebooks
```

The normal project commands do this automatically:

```bash
npm test
npm run lint
npm run homey:validate
npm run homey:build
npm run homey:run
```

`npm run homey:run` is equivalent to generating the codebooks first and then running `homey app run --remote`.

Generated `dynamic_codebook_*.json` compose files are intentionally not tracked. They are deterministic output of `scripts/generate-ir-codebooks.js`.

## Encoding limits

Regular Homey IR signal timings are limited to 5..32767 microseconds. The encoder quantizes each mark and space independently and rejects a timing when the codebook error would exceed 20%. A terminal space longer than 32767 microseconds is clamped because transmission ends in silence anyway; oversized spaces inside a frame are rejected rather than silently changing protocol timing.

Pronto repeat sections are preserved when a button requests multiple repetitions. Raw codes without a separate repeat section use Homey's native signal repetition support.
