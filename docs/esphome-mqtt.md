# ESPHome MQTT gateway

Homey Pro and Homey Bridge do not provide an IR receiver to third-party apps. This app therefore delegates learning to an ESPHome node with an IR receiver. Learned timings are mapped into Homey regular-signal codebooks for transmission through the Homey Bridge selected for the virtual remote.

## Default topics

| Direction | Topic | Payload |
| --- | --- | --- |
| Homey to ESPHome | `homey/ir/learn` | `{"requestId":"<uuid>","maxPresses":5,"requiredMatches":3,"maxFrames":100}` |
| Homey to ESPHome | `homey/ir/learn/stop` | `{"requestId":"<uuid>"}` |
| ESPHome to Homey | `homey/ir/received` | One decoded IR frame with matching `requestId`, `captureIndex` and `receivedAtMs` |

The broker URL and credentials are configurable in the app. The default learning topics are part of the gateway protocol.

## Button press sequence learning

A decoded Pronto message is treated as one IR frame, not automatically as one complete button press. The ESPHome node therefore keeps the learning request active and streams every decoded frame until Homey sends `homey/ir/learn/stop`. `maxFrames` is only a safety limit for a noisy receiver.

Each frame carries a monotonically increasing `captureIndex`, which Homey uses to ignore duplicate MQTT QoS 1 deliveries. `receivedAtMs` is the ESPHome `millis()` timestamp captured when the decoded frame is published. Homey uses the timestamps to preserve inter-frame spacing.

Homey groups frames into one button-press session. A session ends after 250 ms without another valid IR frame. Learning collects five separate button presses and then searches for the longest frame sequence that is present in at least three presses. Corresponding frame positions are compared with the existing timing consensus logic, so timing jitter does not force byte-for-byte equality.

This allows the learner to preserve commands that consist of more than one decoded frame, for example a full frame followed by one or more short repeat frames. The resulting button code is stored as an IR sequence containing the normalized frames and the measured delay between them. A legacy one-frame ProntoHex/raw button remains fully supported.

The final idle space inside a decoded frame is excluded from similarity matching because demodulating IR receivers may measure it inconsistently or omit it entirely. A single missing terminal Pronto space can be synthesized by the converter. Other malformed Pronto lengths remain invalid.

After the fifth completed press, Homey either stores the stable sequence or fails the learning request. In both cases it publishes `homey/ir/learn/stop` so the ESPHome node immediately leaves learning mode. The complete learning operation times out after 30 seconds.

## Learning response

Raw timings:

```json
{
  "requestId": "7c03d8f2-...",
  "captureIndex": 1,
  "receivedAtMs": 1234567,
  "maxFrames": 100,
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
  "receivedAtMs": 1234567,
  "maxFrames": 100,
  "format": "pronto",
  "code": "0000 006D 0022 0000 ..."
}
```

Raw timings may be signed as ESPHome emits them; the converter uses their absolute mark/space durations. Raw signals default to 38000 Hz when no carrier is supplied and accept carriers in the app-supported 30000-58000 Hz range.

The reference ESPHome firmware is stored in `esp8285_firmware/homey-ir-blaster-firmware.yaml`. Sequence learning requires the current firmware because older firmware stops after five decoded frames instead of streaming a complete set of button presses.
