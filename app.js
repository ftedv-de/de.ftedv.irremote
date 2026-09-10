'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const MqttService = require('./lib/MqttService');
const IrCodeConverter = require('./lib/IrCodeConverter');

const IR_SIGNAL_ID = 'dynamic_raw_ir';
const IR_CARRIER = 38000;
const IR_WORDS = [
  [4707, 4523], // header
  [605, 552], // short bit
  [605, 1683], // long bit
  [579, 10124], // trailer
];
const TIMING_TOLERANCE = 0.25;
const CARRIER_TOLERANCE_HZ = 1500;

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

    const raw = IrCodeConverter.codeToRaw(code);
    if (Math.abs(raw.carrier - IR_CARRIER) > CARRIER_TOLERANCE_HZ) {
      throw new Error(
        `IR carrier ${raw.carrier} Hz cannot be sent by the current ${IR_CARRIER} Hz signal`,
      );
    }

    const frame = this.rawTimingsToFrame(raw.intro);
    const signal = this.homey.rf.getSignalInfrared(IR_SIGNAL_ID);

    this.log(
      `=== RF TX STORED IR: format=${code.format}, carrier=${raw.carrier}Hz, repetitions=${repetitions}, frameWords=${frame.length} ===`,
    );
    this.log(`Encoded stored IR frame: ${frame.join(',')}`);

    try {
      const result = await signal.tx(frame, {
        repetitions,
        device,
      });
      this.log(
        'stored IR tx succeeded',
        typeof result === 'undefined' ? '<undefined>' : result,
      );
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this.log(`stored IR tx rejected: ${message}`);
      throw error;
    }
  }

  rawTimingsToFrame(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0) {
      throw new Error('Raw IR timings must contain complete mark/space pairs');
    }

    const frame = [];
    for (let offset = 0; offset < raw.length; offset += 2) {
      const pair = [Math.abs(raw[offset]), Math.abs(raw[offset + 1])];
      const match = this.findClosestIrWord(pair);
      if (!match) {
        throw new Error(
          `Unsupported IR timing pair ${pair[0]}/${pair[1]} us at pair ${offset / 2}`,
        );
      }
      frame.push(match.index);
    }
    return frame;
  }

  findClosestIrWord(pair) {
    let best = null;

    IR_WORDS.forEach((word, index) => {
      const markError = Math.abs(pair[0] - word[0]) / word[0];
      const spaceError = Math.abs(pair[1] - word[1]) / word[1];
      if (markError > TIMING_TOLERANCE || spaceError > TIMING_TOLERANCE) return;

      const score = markError + spaceError;
      if (!best || score < best.score) best = { index, score };
    });

    return best;
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
