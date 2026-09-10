Erstellt echte Homey-Geräte für Infrarot-Fernbedienungen mit beliebig vielen konfigurierbaren Tasten.

Über die Reparaturansicht einer Fernbedienung lassen sich ihre Tasten hinzufügen, bearbeiten, anlernen, testen oder löschen. IR-Codes können über ein ESPHome-MQTT-Gateway angelernt oder manuell als ProntoHex beziehungsweise Raw-JSON-Array eingetragen werden. Gespeicherte Tasten erscheinen in der Geräteansicht und lassen sich außerdem über eine Flow-Aktionskarte senden. Gesendet wird über den IR-Blaster von Homey Pro und Homeys experimentelle ProntoHex-API.

Alle Fernbedienungen und Tasten können gemeinsam als JSON-Datei exportiert werden. Beim Hinzufügen eines neuen IR-Fernbedienungsgeräts kann diese Datei importiert werden; dabei werden alle Fernbedienungen wieder als Homey-Geräte angelegt.

Die globalen App-Einstellungen enthalten nur noch die MQTT-Verbindung und den JSON-Export. Das verwendete MQTT-Protokoll ist unter docs/esphome-mqtt.md beschrieben.
