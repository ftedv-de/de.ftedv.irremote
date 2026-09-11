# ESPHome MQTT gateway

Homey Pro and Homey Bridge do not provide an IR receiver to third-party apps. This app therefore delegates learning to an ESPHome node with an IR receiver. Learned timings are mapped into Homey regular-signal codebooks for transmission through the Homey Bridge selected for the virtual remote.

## Default topics

| Direction | Topic | Payload |
| --- | --- | --- |
| Homey to ESPHome | `homey/ir/learn` | `{"requestId":"<uuid>","maxCaptures":5,"requiredMatches":3}` |
| Homey to ESPHome | `homey/ir/learn/stop` | `{"requestId":"<uuid>"}` |
| ESPHome to Homey | `homey/ir/received` | Learned capture, matching `requestId`, and `captureIndex` |

The broker URL and credentials are configurable in the app. The default learning topics are part of the gateway protocol.

## Multi-capture learning

The ESPHome node keeps one learning request active and publishes up to five captures for that request. Each capture carries a monotonically increasing `captureIndex`. Homey uses this index to ignore duplicate MQTT QoS 1 deliveries.

Homey does not simply accept the first frame. It validates all captures, compares their carrier, section layout and mark/space timings, and accepts the learning request as soon as at least three captures form one sufficiently similar cluster. This also permits alternating toggle variants such as `A/B/A/B/A`: the three `A` frames can form consensus without merging the distinct `B` variant.

The final idle space is excluded from similarity matching because demodulating IR receivers may measure it inconsistently or omit it entirely. A single missing terminal Pronto space can be synthesized by the converter. Other malformed Pronto lengths remain invalid.

If three matching captures are found before the fifth capture, Homey publishes `homey/ir/learn/stop` so the ESPHome node immediately leaves learning mode. If no 3-of-5 consensus is found, the learning request fails without crashing the app.

## Learning response

Raw timings:

```json
{
  "requestId": "7c03d8f2-...",
  "captureIndex": 1,
  "maxCaptures": 5,
  "format": "raw",
  "carrier": 38000,
  "code": [9000, -4500, 560, -560, 560, -1690]
}
```

ProntoHex:

```json
{
  "requestId": "7c03d8f2-...",
  "captureIndex": 1,
  "maxCaptures": 5,
  "format": "pronto",
  "code": "0000 006D 0022 0000 ..."
}
```

The app waits for at most 30 seconds. Raw timings may be signed as ESPHome emits them; the converter uses their absolute mark/space durations. Raw signals default to 38000 Hz when no carrier is supplied and accept carriers in the app-supported 30000-58000 Hz range.

The reference ESPHome firmware is stored in `esp8285_firmware/homey-ir-blaster-firmware.yaml`.
