'use strict';

const fs = require('fs');
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
    this.logRfDiagnostics();
  }

  async onUninit() {
    await this.mqtt.destroy();
  }

  /**
   * Inspect the RF manager plus the actual SDK modules loaded inside the Homey
   * app process. This lets us trace the private app->core RF RPC without
   * guessing event names or transmitting anything.
   */
  logRfDiagnostics() {
    try {
      const rf = this.homey.rf;

      this.log('=== RF MANAGER DIAGNOSTICS ===');
      this.log('RF own properties:', Object.getOwnPropertyNames(rf));
      this.logPrototypeChain('RF manager', rf);

      for (const methodName of [
        'tx',
        'cmd',
        '_getSignalDefinition',
        '_validateSignal',
        'getSignalInfrared',
      ]) {
        const method = rf[methodName];
        if (typeof method === 'function') {
          this.log(
            `RF manager ${methodName}():`,
            Function.prototype.toString.call(method).slice(0, 12000),
          );
        }
      }

      this.log('=== RF CLIENT DIAGNOSTICS ===');
      const client = rf.__client;
      if (client) {
        this.log('RF __client own properties:', Object.getOwnPropertyNames(client));
        this.logPrototypeChain('RF __client', client, true);
      } else {
        this.log('RF __client is not available');
      }

      this.logHomeySdkSources();
    } catch (error) {
      this.error('RF runtime diagnostics failed', error);
    }
  }

  logHomeySdkSources() {
    this.log('=== HOMEY SDK SOURCE DIAGNOSTICS ===');

    try {
      this.log('require.resolve("homey"):', require.resolve('homey'));
    } catch (error) {
      this.log('Could not resolve app-facing Homey entry:', error.message);
    }

    const cacheEntries = Object.values(require.cache || {});
    this.log('require.cache entry count:', cacheEntries.length);

    const sdkEntries = cacheEntries.filter((moduleEntry) => {
      const filename = moduleEntry && moduleEntry.filename;
      return typeof filename === 'string'
        && (/homey-apps-sdk-v3/i.test(filename)
          || /[/\\]manager[/\\]rf(?:[/\\]|\.js$)/i.test(filename)
          || /signal.*infrared/i.test(filename));
    });

    this.log('Loaded SDK/RF module filenames:', sdkEntries.map((entry) => entry.filename));

    const interestingEntries = sdkEntries.filter((entry) => /(?:manager[/\\]rf\.js|signal|infrared)/i.test(entry.filename));

    for (const entry of interestingEntries) {
      const filename = entry.filename;
      this.log(`=== LOADED MODULE ${filename} ===`);

      try {
        if (fs.existsSync(filename)) {
          this.log(fs.readFileSync(filename, 'utf8').slice(0, 60000));
        } else {
          this.log('Loaded module filename is not directly readable from app filesystem');
        }
      } catch (error) {
        this.log(`Could not read ${filename}:`, error.message);
      }

      if (entry.exports) {
        try {
          const exported = entry.exports;
          this.log('Export type:', typeof exported);
          this.log('Export own properties:', Object.getOwnPropertyNames(exported));
          if (typeof exported === 'function') {
            this.log('Export function source:', Function.prototype.toString.call(exported).slice(0, 30000));
            if (exported.prototype) {
              this.logPrototypeChain(`Export ${exported.name || '<anonymous>'}`, exported.prototype, true);
            }
          } else if (typeof exported === 'object') {
            this.logPrototypeChain(`Export ${filename}`, exported, true);
          }
        } catch (error) {
          this.log(`Could not inspect exports for ${filename}:`, error.message);
        }
      }
    }

    if (interestingEntries.length === 0) {
      this.log('No RF/Signal SDK modules were visible in require.cache');
    }
  }

  logPrototypeChain(label, object, includeFunctions = false) {
    let current = object;
    let level = 0;

    while (current && level < 10) {
      const constructorName = current.constructor?.name || '<unknown>';
      const propertyNames = Object.getOwnPropertyNames(current);

      this.log(`${label} prototype ${level} (${constructorName}):`, propertyNames);

      if (includeFunctions) {
        for (const propertyName of propertyNames) {
          if (propertyName === 'constructor') continue;

          let value;
          try {
            value = current[propertyName];
          } catch (error) {
            this.log(`${label}.${propertyName}: <getter threw: ${error.message}>`);
            continue;
          }

          if (typeof value === 'function') {
            this.log(
              `${label}.${propertyName}():`,
              Function.prototype.toString.call(value).slice(0, 12000),
            );
          }
        }
      }

      current = Object.getPrototypeOf(current);
      level += 1;
    }
  }

  /**
   * Dynamic ProntoHex transmission with satellite routing is not exposed by
   * the public Apps SDK. Keep the device parameter here because Homey uses it
   * for satellite routing on native signal.cmd()/signal.tx() calls.
   */
  async sendIR(code, repetitions = 1, device) {
    if (!device) throw new Error('A Homey device is required for IR satellite routing');

    const payload = code.format === 'pronto'
      ? code.code
      : this.rawToProntoHex(code.code, code.carrier || 38000);

    throw new Error(
      `Dynamic ProntoHex satellite transmission is not available through the public Apps SDK (repetitions=${repetitions}, words=${payload.split(/\s+/).length})`,
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
