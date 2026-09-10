# ESPHome MQTT gateway

Homey Pro and Homey Bridge do not provide an IR receiver to third-party apps. This app therefore delegates learning to an ESPHome node with an IR receiver. Transmission uses Homey Pro's IR blaster through Homey's experimental ProntoHex API.

## Default topics

| Direction | Topic | Payload |
| --- | --- | --- |
| Homey to ESPHome | `homey/ir/learn` | `{"requestId":"<uuid>"}` |
| ESPHome to Homey | `homey/ir/received` | Learned code and the same `requestId` |

The broker URL, credentials and all topic names can be changed in the app settings.

## Learning response

Raw timings:

```json
{
  "requestId": "7c03d8f2-...",
  "format": "raw",
  "code": [9000, -4500, 560, -560, 560, -1690]
}
```

ProntoHex:

```json
{
  "requestId": "7c03d8f2-...",
  "format": "pronto",
  "code": "0000 006D 0022 0002 ..."
}
```

The app accepts one response for each request and waits for at most 30 seconds. Raw timings use ESPHome's convention: positive values switch the carrier on and negative values switch it off.

The ESPHome configuration must subscribe to the learn topic, remember the active `requestId`, and publish the next received raw signal. ESPHome's exact YAML syntax can vary by release, so keep this JSON contract stable when updating the node firmware.

Raw signals may additionally provide a `carrier` between 30000 and 45000 Hz. The default is 38000 Hz. Homey converts these timings to ProntoHex before transmission.
