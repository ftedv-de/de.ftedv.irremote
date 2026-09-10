'use strict';

const mqtt = require('mqtt');
const { randomUUID } = require('crypto');
const IrCodeConverter = require('./IrCodeConverter');

const DEFAULT_TOPICS = {
  learn: 'homey/ir/learn',
  received: 'homey/ir/received',
};

module.exports = class MqttService {

  constructor(app) {
    this.app = app;
    this.client = null;
    this.pendingLearn = new Map();
  }

  async init() {
    const config = this.getConfig();
    if (config.url) await this.connect(config);
  }

  getConfig() {
    const config = this.app.homey.settings.get('mqtt') || {};
    return {
      url: typeof config.url === 'string' ? config.url.trim() : '',
      username: typeof config.username === 'string' ? config.username : '',
      password: typeof config.password === 'string' ? config.password : '',
      topics: { ...DEFAULT_TOPICS, ...(config.topics || {}) },
    };
  }

  async connect(config) {
    await this.destroy();

    const client = mqtt.connect(config.url, {
      username: config.username || undefined,
      password: config.password || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });
    this.client = client;

    client.on('error', (error) => this.app.error('MQTT error', error));
    client.on('message', (topic, payload) => this.onMessage(topic, payload));

    try {
      await new Promise((resolve, reject) => {
        const timer = this.app.homey.setTimeout(
          () => reject(new Error('MQTT connection timed out')),
          10000,
        );

        const cleanup = () => this.app.homey.clearTimeout(timer);

        client.once('connect', () => {
          client.subscribe(config.topics.received, (error) => {
            cleanup();
            if (error) reject(error);
            else resolve();
          });
        });
        client.once('error', (error) => {
          cleanup();
          reject(error);
        });
      });
    } catch (error) {
      if (this.client === client) this.client = null;
      client.end(true);
      throw error;
    }
  }

  async reconnect() {
    const config = this.getConfig();
    if (!config.url) return this.destroy();
    return this.connect(config);
  }

  async destroy() {
    for (const pending of this.pendingLearn.values()) {
      this.app.homey.clearTimeout(pending.timer);
      pending.reject(new Error('MQTT connection closed'));
    }
    this.pendingLearn.clear();

    if (!this.client) return;
    const { client } = this;
    this.client = null;
    await new Promise((resolve) => {
      client.end(false, {}, resolve);
    });
  }

  async learn(timeout = 30000) {
    this.assertConnected();
    if (this.pendingLearn.size > 0) {
      throw new Error('Another IR button is already being learned');
    }
    const requestId = randomUUID();
    const config = this.getConfig();

    const result = new Promise((resolve, reject) => {
      const timer = this.app.homey.setTimeout(() => {
        this.pendingLearn.delete(requestId);
        reject(new Error('No IR signal was received within 30 seconds'));
      }, timeout);
      this.pendingLearn.set(requestId, { resolve, reject, timer });
    });

    try {
      await this.publish(config.topics.learn, { requestId });
    } catch (error) {
      const pending = this.pendingLearn.get(requestId);
      if (pending) this.app.homey.clearTimeout(pending.timer);
      this.pendingLearn.delete(requestId);
      throw error;
    }
    return result;
  }

  onMessage(topic, payload) {
    const config = this.getConfig();
    if (topic !== config.topics.received) return;

    try {
      const message = JSON.parse(payload.toString());
      const pending = this.pendingLearn.get(message.requestId);
      if (!pending) return;

      const code = this.validateCode(message);
      this.app.homey.clearTimeout(pending.timer);
      this.pendingLearn.delete(message.requestId);
      pending.resolve(code);
    } catch (error) {
      this.app.error('Invalid IR MQTT message', error);
    }
  }

  validateCode(value) {
    return IrCodeConverter.normalizeCode(value);
  }

  assertConnected() {
    if (!this.client || !this.client.connected) {
      throw new Error('MQTT is not connected');
    }
  }

  publish(topic, value) {
    this.assertConnected();
    return new Promise((resolve, reject) => {
      this.client.publish(topic, JSON.stringify(value), { qos: 1 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

};
