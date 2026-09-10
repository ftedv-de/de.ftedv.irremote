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
    this.logHomeyClientDiagnostics();
  }

  async onUninit() {
    await this.mqtt.destroy();
  }

  /**
   * Inspect the SDK classes that create and configure Homey's native manager
   * clients. We already know RF __client.emit() only accepts whitelisted app
   * events; this diagnostic looks for where that whitelist/routing is defined.
   * No RF command is transmitted here.
   */
  logHomeyClientDiagnostics() {
    try {
      this.log('=== HOMEY CLIENT ROUTING DIAGNOSTICS ===');

      this.log('Homey own properties:', Object.getOwnPropertyNames(this.homey));
      if (this.homey.__client) {
        this.log('Homey __client own properties:', Object.getOwnPropertyNames(this.homey.__client));
      }

      const rfClient = this.homey.rf && this.homey.rf.__client;
      if (rfClient) {
        this.log('RF __client own properties:', Object.getOwnPropertyNames(rfClient));
        this.log('RF __client symbols:', Object.getOwnPropertySymbols(rfClient).map((symbol) => symbol.toString()));
        this.log('RF __client descriptors:', this.describeObject(rfClient));
      }

      const wanted = [
        '/lib/HomeyClient.js',
        '/lib/Homey.js',
        '/lib/SDK.js',
        '/lib/Manager.js',
        '/manager/rf.js',
      ];

      const entries = Object.values(require.cache || {}).filter((entry) => (
        entry
        && typeof entry.filename === 'string'
        && wanted.some((suffix) => entry.filename.endsWith(suffix))
      ));

      this.log('Target SDK modules:', entries.map((entry) => entry.filename));

      for (const entry of entries) {
        this.log(`=== SDK EXPORT ${entry.filename} ===`);
        const exported = entry.exports;
        this.log('Export type:', typeof exported);
        this.log('Export own properties:', exported ? Object.getOwnPropertyNames(exported) : []);

        if (typeof exported === 'function') {
          this.log(
            'Export function source:',
            Function.prototype.toString.call(exported).slice(0, 50000),
          );

          if (exported.prototype) {
            const names = Object.getOwnPropertyNames(exported.prototype);
            this.log(`Prototype methods for ${exported.name}:`, names);
            for (const name of names) {
              if (name === 'constructor') continue;
              const value = exported.prototype[name];
              if (typeof value !== 'function') continue;
              this.log(
                `${exported.name}.${name}():`,
                Function.prototype.toString.call(value).slice(0, 20000),
              );
            }
          }
        }
      }
    } catch (error) {
      this.error('Homey client routing diagnostics failed', error);
    }
  }

  describeObject(object) {
    const result = {};
    for (const name of Object.getOwnPropertyNames(object)) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(object, name);
        result[name] = {
          enumerable: descriptor && descriptor.enumerable,
          configurable: descriptor && descriptor.configurable,
          writable: descriptor && descriptor.writable,
          type: typeof object[name],
          value: typeof object[name] === 'function'
            ? Function.prototype.toString.call(object[name]).slice(0, 500)
            : object[name],
        };
      } catch (error) {
        result[name] = `<inspection failed: ${error.message}>`;
      }
    }
    return result;
  }

  /**
   * Dynamic ProntoHex + satellite routing is still unresolved. The previous
   * probe established that guessed private RF event names are rejected before
   * payload validation with "Invalid App Event". Keep sendIR non-transmitting
   * until the actual allowed core event surface is identified.
   */
  async sendIR(code, repetitions = 1, device) {
    if (!device) throw new Error('A Homey device is required for IR satellite routing');

    const payload = code.format === 'pronto'
      ? code.code
      : this.rawToProntoHex(code.code, code.carrier || 38000);

    throw new Error(
      `Dynamic ProntoHex satellite transmission is not yet available (repetitions=${repetitions}, words=${payload.split(/\s+/).length})`,
    );
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
