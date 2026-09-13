'use strict';

const Homey = require('homey');
const IrSequence = require('../../lib/IrSequence');
const IrOutputSettings = require('../../lib/IrOutputSettings');
const IrEspHomeEncoder = require('../../lib/IrEspHomeEncoder');

module.exports = class IRRemoteDevice extends Homey.Device {

  async onInit() {
    this.registeredButtonCapabilities = new Set();
    if (!Array.isArray(this.getStoreValue('buttons'))) {
      await this.setStoreValue('buttons', []);
    }
    await this.syncButtonCapabilities();
  }

  async onSettings({ newSettings }) {
    const output = IrOutputSettings.fromDeviceSettings(newSettings);
    if (output.type === IrOutputSettings.OUTPUT_ESPHOME) {
      if (!output.mqttSendTopic) {
        throw new Error(this.homey.__('device.settings.mqtt_topic_required'));
      }
      if (/[+#]/.test(output.mqttSendTopic)) {
        throw new Error(this.homey.__('device.settings.mqtt_topic_invalid'));
      }
    }
  }

  getOutputSettings() {
    return IrOutputSettings.fromDeviceSettings(this.getSettings());
  }

  cloneButtons(buttons) {
    return buttons.map((button) => ({
      ...button,
      code: button.code ? IrSequence.clone(button.code) : null,
    }));
  }

  getButtons() {
    const buttons = this.getStoreValue('buttons');
    return Array.isArray(buttons) ? this.cloneButtons(buttons) : [];
  }

  async setButtons(buttons) {
    if (!Array.isArray(buttons)) throw new TypeError('Buttons must be an array');
    const snapshot = this.cloneButtons(buttons);
    await this.setStoreValue('buttons', snapshot);
    await this.syncButtonCapabilities();
  }

  async sendButton(buttonId) {
    const button = this.getButtons().find((item) => item.id === buttonId);
    if (!button) throw new Error('Button not found');
    if (!button.code) throw new Error('Button has no learned IR code');

    const output = IrOutputSettings.validate(this.getOutputSettings());
    if (output.type === IrOutputSettings.OUTPUT_ESPHOME) {
      const payload = IrEspHomeEncoder.encode(button.code, button.repetitions || 1);
      this.homey.app.debugLog(
        `ESPHome IR TX: topic=${output.mqttSendTopic}, carrier=${payload.carrier}Hz, `
        + `repetitions=${payload.repetitions}, timings=${payload.timings.length}`,
      );
      await this.homey.app.mqtt.publish(output.mqttSendTopic, payload);
      return;
    }

    await this.homey.app.sendIR(button.code, button.repetitions || 1, this);
  }

  getButtonCapabilityId(buttonId) {
    return `button.${buttonId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  }

  async syncButtonCapabilities() {
    const buttons = this.getButtons();
    const expected = new Map(buttons.map((button) => [
      this.getButtonCapabilityId(button.id),
      button,
    ]));

    for (const capabilityId of this.getCapabilities()) {
      if (capabilityId.startsWith('button.') && !expected.has(capabilityId)) {
        await this.removeCapability(capabilityId);
        this.registeredButtonCapabilities.delete(capabilityId);
      }
    }

    for (const [capabilityId, button] of expected) {
      if (!this.hasCapability(capabilityId)) {
        await this.addCapability(capabilityId);
      }
      await this.setCapabilityOptions(capabilityId, {
        title: {
          en: button.name,
          de: button.name,
        },
        preventInsights: true,
        preventTag: true,
      });

      if (!this.registeredButtonCapabilities.has(capabilityId)) {
        this.registerCapabilityListener(capabilityId, async () => this.sendButton(button.id));
        this.registeredButtonCapabilities.add(capabilityId);
      }
    }
  }

};
