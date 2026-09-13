# ESPHome MQTT gateway

Homey Pro and Homey Bridge do not provide an IR receiver to third-party apps. This app therefore delegates learning to an ESPHome node with an IR receiver. A virtual remote can transmit either through Homey/the selected Homey Bridge or through an ESPHome IR blaster over MQTT.

## Default topics

| Direction | Topic | Payload |
| --- | --- | --- |
| Homey to ESPHome | `homey/ir/learn` | `{"requestId":"<uuid>","maxPresses":5,"requiredMatches":3,"maxFrames":100}` |
| Homey to ESPHome | `homey/ir/learn/stop` | `{"requestId":"<uuid>"}` |
| ESPHome to Homey | `homey/ir/received` | One decoded IR frame with matching `requestId`, `captureIndex` and `receivedAtMs` |
| Homey to ESPHome | `homey/ir/send` | Raw signed timings, carrier frequency and repetition count |

The broker URL and credentials are configurable in the app. The learning topics are part of the gateway protocol. The send topic is configured per virtual remote and must match the `ir_send_topic` substitution in the target ESPHome firmware. This makes it possible to address multiple IR blasters with different MQTT topics.

## ESPHome transmission

Set the virtual remote's **IR output** Advanced Setting to **ESPHome (MQTT)** and enter its **MQTT send topic**. Homey validates that a non-empty publish topic without MQTT wildcards is present before the settings can be saved.

Homey normalizes the stored ProntoHex/raw code and publishes a carrier plus signed raw timings. Positive values are marks and negative values are spaces. Multi-frame button sequences using the same carrier are combined before publishing: the learned `delayAfterMs` is added directly to the preceding terminal space. This avoids MQTT scheduling latency between the frames and preserves the learned inter-frame timing.

Example payload:

```json
{
  "version": 1,
  "carrier": 38000,
  "repetitions": 1,
  "timings": [9000, -4500, 560, -560, 560, -39000, 9000, -2250, 560, -10000]
}
```

The reference firmware validates the carrier, repetitions, timing count and mark/space polarity before passing the raw waveform to ESPHome's `remote_transmitter`. Sequences whose frames use different carrier frequencies are currently rejected for ESPHome output instead of being split into separate MQTT transmissions, because splitting them would lose deterministic inter-frame timing.

The firmware defaults to:

```yaml
substitutions:
  ir_send_topic: "homey/ir/send"
```

Use a unique topic for each physical blaster when more than one ESPHome sender is deployed.

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

The reference ESPHome firmware is stored in `esp8285_firmware/homey-ir-blaster-firmware.yaml`. Sequence learning and MQTT transmission require the current firmware.
