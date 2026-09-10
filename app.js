'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const MqttService = require('./lib/MqttService');

module.exports = class IRRemoteApp extends Homey.App {

  async onInit() {
    this.mqtt = new MqttService(this);
    await this.mqtt.init().catch((error) => this.error('MQTT initialization failed', error));

    const sendButtonCard = this.homey.flow.getActionCard('send_button');
    sendButtonCard.registerArgumentAutocompleteListener('button', async (query, args) => {
      const { device } = args;
      if (!device) return [];

      return device.getButtons()
        .filter((button) => button.name.toLowerCase().includes(query.toLowerCase()))
        .map((button) => ({
          id: button.id,
          name: button.name,
          description: button.type,
        }));
    });
    sendButtonCard.registerRunListener(async (args) => {
      await args.device.sendButton(args.button.id);
      return true;
    });

    this.homey.settings.on('set', (key) => {
      if (key === 'mqtt') this.mqtt.reconnect().catch((error) => this.error(error));
    });

    this.log('IR Remote has been initialized');
  }

  async onUninit() {
    await this.mqtt.destroy();
  }

  async sendIR(code, repetitions = 1, device) {
    if (!device) throw new Error('A Homey device is required for IR satellite routing');

    const client = this.homey.rf && this.homey.rf.__client;
    if (!client || typeof client.emit !== 'function') {
      throw new Error('Homey RF core client is unavailable');
    }

    // Diagnostic: this exact ProntoHex was proven to work when stored statically
    // as the RUNTIME command in the Homey manifest.
    const payload = '0000 006D 0022 0000 00B3 00AC 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0040 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0040 0016 0181';

    const request = {
      signalId: 'dynamic_ir',
      frequency: 'ir',
      commandId: 'RUNTIME',
      opts: {
        repetitions,
        device,
      },
      payload,
    };

    this.log(
      `=== RF CMD DYNAMIC OVERRIDE PROBE: repetitions=${repetitions}, prontoWords=${payload.split(/\s+/).length} ===`,
    );
    this.log('Manifest RUNTIME contains neutral fallback; top-level payload contains known working Samsung code');

    try {
      const result = await client.emit('cmd', request);
      this.log(
        'Dynamic override probe succeeded',
        typeof result === 'undefined' ? '<undefined>' : result,
      );
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this.log(`Dynamic override probe rejected: ${message}`);
      throw error;
    }
  }

  rawToProntoHex(raw, carrier) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0) {
      throw new Error('Raw IR code must contain complete mark/space pairs');
    }
    if (!Number.isInteger(carrier) || carrier < 30000 || carrier > 45000) {
      throw new Error('IR carrier must be between 30000 and 45000 Hz');
    }

    const frequencyWord = Math.round(1000000 / (carrier * 0.241246));
    const durationWords = raw.map((duration) => Math.max(
      1,
      Math.round((Math.abs(duration) * carrier) / 1000000),
    ));
    const words = [0, frequencyWord, raw.length / 2, 0, ...durationWords];
    return words.map((word) => word.toString(16).toUpperCase().padStart(4, '0')).join(' ');
  }

  getRemoteDevices() {
    return this.homey.drivers.getDriver('ir_remote').getDevices();
  }

  getRemote(deviceId) {
    const device = this.getRemoteDevices().find((item) => item.getData().id === deviceId);
    if (!device) throw new Error('Remote not found');
    return device;
  }

  validateButtons(buttons) {
    if (!Array.isArray(buttons)) throw new Error('Buttons must be an array');
    return buttons.map((button) => {
      if (!button || typeof button.name !== 'string' || !button.name.trim()) {
        throw new Error('Every button needs a name');
      }
      if (typeof button.type !== 'string' || !button.type.trim()) {
        throw new Error('Every button needs a type');
      }
      const repetitions = Number(button.repetitions || 1);
      if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
        throw new Error('Repetitions must be between 1 and 20');
      }

      let code = null;
      if (button.code) code = this.mqtt.validateCode(button.code);
      return {
        id: typeof button.id === 'string' && button.id ? button.id : randomUUID(),
        name: button.name.trim().slice(0, 80),
        type: button.type.trim().slice(0, 40),
        repetitions,
        code,
      };
    });
  }

};
