'use strict';

const Homey = require('homey');
const { randomUUID } = require('crypto');
const MqttService = require('./lib/MqttService');

module.exports = class IRRemoteApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
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

  /**
   * Probe Homey's private app->core RF request channel for a dynamic ProntoHex
   * operation that still accepts the normal Apps SDK device routing context.
   *
   * The public Apps SDK only exposes cmd()/tx() for manifest-defined signals,
   * while the Web API exposes dynamic ProntoHex without a device option. The
   * normal RF cmd()/tx() implementation forwards opts.device unchanged to the
   * Homey Core transport, so these probes use that same shape.
   */
  async sendIR(code, repetitions = 1, device) {
    if (!device) throw new Error('A Homey device is required for IR satellite routing');

    const payload = code.format === 'pronto'
      ? code.code
      : this.rawToProntoHex(code.code, code.carrier || 38000);

    const client = this.homey.rf && this.homey.rf.__client;
    if (!client || typeof client.emit !== 'function') {
      throw new Error('Homey RF core client is unavailable');
    }

    const opts = {
      repetitions,
      device,
    };

    const probes = [
      {
        name: 'txInfraredProntohex(opts.device)',
        event: 'txInfraredProntohex',
        data: { payload, repetitions, opts },
      },
      {
        name: 'prontohex(opts.device)',
        event: 'prontohex',
        data: { payload, repetitions, opts },
      },
      {
        name: 'ir/prontohex(opts.device)',
        event: 'ir/prontohex',
        data: { payload, repetitions, opts },
      },
      {
        name: 'txProntohex(opts.device)',
        event: 'txProntohex',
        data: { payload, repetitions, opts },
      },
    ];

    this.log(
      `=== DYNAMIC IR CORE PROBE: repetitions=${repetitions}, words=${payload.split(/\s+/).length} ===`,
    );

    const failures = [];

    for (const probe of probes) {
      this.log(`Trying RF core request: ${probe.name}`);

      try {
        const result = await client.emit(probe.event, probe.data);
        this.log(`RF core request succeeded: ${probe.name}`, result);
        return result;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        failures.push(`${probe.name}: ${message}`);
        this.log(`RF core request rejected: ${probe.name}: ${message}`);
      }
    }

    throw new Error(`No dynamic IR core request was accepted. ${failures.join(' | ')}`);
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
