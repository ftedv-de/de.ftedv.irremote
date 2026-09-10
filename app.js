'use strict';

const fs = require('fs');
const path = require('path');
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
   * Inspect the RF manager plus the actual SDK source files loaded inside the
   * Homey app process. This lets us trace the private app->core RF RPC without
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

    let homeyEntry;
    try {
      homeyEntry = require.resolve('homey');
      this.log('require.resolve("homey"):', homeyEntry);
    } catch (error) {
      this.error('Could not resolve Homey SDK entry', error);
      return;
    }

    const candidates = [];
    let current = path.dirname(homeyEntry);

    for (let i = 0; i < 8; i += 1) {
      candidates.push(path.join(current, 'manager', 'rf.js'));
      candidates.push(path.join(current, 'manager', 'rf', 'index.js'));
      current = path.dirname(current);
    }

    let rfSourcePath = candidates.find((candidate) => fs.existsSync(candidate));

    if (!rfSourcePath) {
      try {
        rfSourcePath = require.resolve('@athombv/homey-apps-sdk-v3/manager/rf');
      } catch (error) {
        this.log('Direct @athombv/homey-apps-sdk-v3/manager/rf resolve failed:', error.message);
      }
    }

    if (!rfSourcePath || !fs.existsSync(rfSourcePath)) {
      this.log('Could not locate RF SDK source file');
      return;
    }

    this.log('RF SDK source path:', rfSourcePath);

    try {
      const source = fs.readFileSync(rfSourcePath, 'utf8');
      this.log('=== RF.JS SOURCE ===');
      this.log(source.slice(0, 40000));

      const requireTargets = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
        .map((match) => match[1])
        .filter((target) => /signal|infrared|rf/i.test(target));

      this.log('RF source interesting require() targets:', requireTargets);

      for (const target of [...new Set(requireTargets)]) {
        try {
          const resolved = require.resolve(target, { paths: [path.dirname(rfSourcePath)] });
          this.log(`Resolved ${target}:`, resolved);

          if (fs.existsSync(resolved)) {
            this.log(`=== SOURCE ${target} ===`);
            this.log(fs.readFileSync(resolved, 'utf8').slice(0, 40000));
          }
        } catch (error) {
          this.log(`Could not resolve ${target}:`, error.message);
        }
      }
    } catch (error) {
      this.error('Failed reading RF SDK source', error);
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
