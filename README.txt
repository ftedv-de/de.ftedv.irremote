Create real Homey devices for your infrared remotes and configure any number of buttons.

Open a remote's Repair screen to add, edit, learn, test or delete its buttons. IR codes can be learned through an ESPHome MQTT gateway or entered manually as ProntoHex or a raw JSON array. Saved buttons are displayed in the device UI and can also be sent from a Flow action card. Transmission uses Homey Pro's IR blaster through Homey's experimental ProntoHex API.

All remotes and their buttons can be exported as one JSON file. Import the file while adding a new IR Remote device to recreate all remotes as Homey devices.

The global app settings contain only the MQTT connection and JSON export. See docs/esphome-mqtt.md for the MQTT protocol used by the app.
