'use strict';

module.exports = {

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

};
