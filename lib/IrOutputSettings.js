'use strict';

const OUTPUT_HOMEY = 'homey';
const OUTPUT_ESPHOME = 'esphome';

class IrOutputSettings {

  static normalize(value = {}) {
    const type = value.type === OUTPUT_ESPHOME ? OUTPUT_ESPHOME : OUTPUT_HOMEY;
    const mqttSendTopic = typeof value.mqttSendTopic === 'string'
      ? value.mqttSendTopic.trim()
      : '';

    return { type, mqttSendTopic };
  }

  static fromDeviceSettings(settings = {}) {
    return IrOutputSettings.normalize({
      type: settings.ir_output,
      mqttSendTopic: settings.mqtt_send_topic,
    });
  }

  static toDeviceSettings(value = {}) {
    const normalized = IrOutputSettings.normalize(value);
    return {
      ir_output: normalized.type,
      mqtt_send_topic: normalized.mqttSendTopic,
    };
  }

  static validate(value = {}) {
    const normalized = IrOutputSettings.normalize(value);

    if (normalized.type === OUTPUT_ESPHOME) {
      if (!normalized.mqttSendTopic) {
        throw new Error('MQTT send topic is required for ESPHome output');
      }
      if (/[+#]/.test(normalized.mqttSendTopic)) {
        throw new Error('MQTT send topic must not contain + or # wildcards');
      }
    }

    return normalized;
  }

}

IrOutputSettings.OUTPUT_HOMEY = OUTPUT_HOMEY;
IrOutputSettings.OUTPUT_ESPHOME = OUTPUT_ESPHOME;

module.exports = IrOutputSettings;
