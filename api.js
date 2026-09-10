'use strict';

const { randomUUID } = require('crypto');

module.exports = {

  async getRemotes({ homey }) {
    return homey.app.getRemoteDevices().map((device) => ({
      id: device.getData().id,
      name: device.getName(),
      buttons: device.getButtons(),
    }));
  },

  async addButton({ homey, params, body }) {
    const device = homey.app.getRemote(params.deviceId);
    const buttons = device.getButtons();
    const [button] = homey.app.validateButtons([{ ...body, id: randomUUID() }]);
    buttons.push(button);
    await device.setButtons(buttons);
    return button;
  },

  async updateButton({ homey, params, body }) {
    const device = homey.app.getRemote(params.deviceId);
    const buttons = device.getButtons();
    const index = buttons.findIndex((button) => button.id === params.buttonId);
    if (index < 0) throw new Error('Button not found');
    const [button] = homey.app.validateButtons([{ ...buttons[index], ...body, id: params.buttonId }]);
    buttons[index] = button;
    await device.setButtons(buttons);
    return button;
  },

  async deleteButton({ homey, params }) {
    const device = homey.app.getRemote(params.deviceId);
    const buttons = device.getButtons();
    const filtered = buttons.filter((button) => button.id !== params.buttonId);
    if (filtered.length === buttons.length) throw new Error('Button not found');
    await device.setButtons(filtered);
    return true;
  },

  async learnButton({ homey, params }) {
    const device = homey.app.getRemote(params.deviceId);
    const buttons = device.getButtons();
    const index = buttons.findIndex((button) => button.id === params.buttonId);
    if (index < 0) throw new Error('Button not found');
    buttons[index] = { ...buttons[index], code: await homey.app.mqtt.learn() };
    await device.setButtons(buttons);
    return buttons[index];
  },

  async sendButton({ homey, params }) {
    await homey.app.getRemote(params.deviceId).sendButton(params.buttonId);
    return true;
  },

  async getMqtt({ homey }) {
    const config = homey.app.mqtt.getConfig();
    return { ...config, password: '' };
  },

  async setMqtt({ homey, body }) {
    if (!body || typeof body.url !== 'string') throw new Error('MQTT URL is required');
    const previous = homey.app.mqtt.getConfig();
    homey.settings.set('mqtt', {
      url: body.url.trim(),
      username: String(body.username || ''),
      password: body.password ? String(body.password) : previous.password,
      topics: {
        learn: String(body.topics?.learn || 'homey/ir/learn'),
        received: String(body.topics?.received || 'homey/ir/received'),
      },
    });
    return true;
  },

  async getDebug({ homey }) {
    return { enabled: homey.app.isDebugEnabled() };
  },

  async setDebug({ homey, body }) {
    homey.settings.set('debug', body?.enabled === true);
    return { enabled: homey.app.isDebugEnabled() };
  },

  async runIrWordIndexDiagnostic({ homey, body }) {
    if (!body || typeof body.deviceId !== 'string' || !body.deviceId) {
      throw new Error('Remote device is required');
    }
    const wordCount = body.wordCount === undefined ? 1024 : Number(body.wordCount);
    if (!Number.isInteger(wordCount)) throw new Error('Diagnostic word count must be an integer');
    return homey.app.sendIrWordIndexDiagnostic(body.deviceId, wordCount);
  },

  async getExport({ homey }) {
    return {
      schemaVersion: 1,
      appId: homey.app.id,
      exportedAt: new Date().toISOString(),
      remotes: homey.app.getRemoteDevices().map((device) => ({
        name: device.getName(),
        buttons: device.getButtons(),
      })),
    };
  },

};
