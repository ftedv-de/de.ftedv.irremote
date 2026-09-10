'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const MqttService = require('./lib/MqttService');
const IrCodeConverter = require('./lib/IrCodeConverter');
const IrSignalEncoder = require('./lib/IrSignalEncoder');

const IR_SIGNAL_ID = 'dynamic_raw_ir';
const IR_SIGNAL_CONFIG = {
  carrier: 38000,
  words: [
    [4707, 4523], // Samsung/NEC-style header
    [605, 552], // short data space
    [605, 1683], // long data space
    [579, 10124], // trailer
  ],
  timingTolerance: 0.25,
  carrierToleranceHz: 1500,
};

module.exports = class IRRemoteApp extends Homey.App {

  async onInit() {
    this.irEncoder = new IrSignalEncoder(IR_SIGNAL_CONFIG);

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

    const normalizedCode = IrCodeConverter.normalizeCode(code);
    const raw = IrCodeConverter.codeToRaw(normalizedCode);
    const frame = this.irEncoder.encode(raw);
    const signal = this.homey.rf.getSignalInfrared(IR_SIGNAL_ID);

    this.log(
      `IR TX: format=${normalizedCode.format}, carrier=${raw.carrier}Hz, repetitions=${repetitions}, frameWords=${frame.length}`,
    );

    try {
      await signal.tx(frame, {
        repetitions,
        device,
      });
      this.log('IR TX succeeded');
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this.error(`IR TX failed: ${message}`);
      throw error;
    }
  }

  rawToProntoHex(raw, carrier) {
    return IrCodeConverter.rawToProntoHex(raw, carrier);
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
      if (button.code) code = IrCodeConverter.normalizeCode(button.code);
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
