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
    if (!config.url) {
      this.app.log('MQTT is not configured');
      return;
    }

    this.app.log(`MQTT connecting to ${config.url}`);
    await this.connect(config);
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
    client.on('reconnect', () => this.app.log('MQTT reconnecting...'));
    client.on('offline', () => this.app.log('MQTT connection is offline'));
    client.on('close', () => this.app.log('MQTT connection closed'));
    client.on('message', (topic, payload) => this.handleMessage(topic, payload));

    try {
      await new Promise((resolve, reject) => {
        const timer = this.app.homey.setTimeout(
          () => reject(new Error('MQTT connection timed out')),
          10000,
        );

        const cleanup = () => this.app.homey.clearTimeout(timer);

        client.once('connect', () => {
          this.app.log(`MQTT connected to ${config.url}`);

          client.subscribe(config.topics.received, { qos: 1 }, (error, granted) => {
            cleanup();
            if (error) {
              reject(error);
              return;
            }

            const subscriptions = Array.isArray(granted)
              ? granted.map((entry) => `${entry.topic} (QoS ${entry.qos})`).join(', ')
              : config.topics.received;
            this.app.log(`MQTT subscribed: ${subscriptions}`);
            resolve();
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
    if (!config.url) {
      this.app.log('MQTT disabled because no broker URL is configured');
      return this.destroy();
    }

    this.app.log(`MQTT reconnect requested for ${config.url}`);
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
      this.app.debugLog(`MQTT learn request published: ${requestId}`);
    } catch (error) {
      const pending = this.pendingLearn.get(requestId);
      if (pending) this.app.homey.clearTimeout(pending.timer);
      this.pendingLearn.delete(requestId);
      throw error;
    }
    return result;
  }

  handleMessage(topic, payload) {
    try {
      this.onMessage(topic, payload);
    } catch (error) {
      // MQTT is an external input boundary. No malformed or unexpected packet
      // is allowed to escape the event handler and destabilize the app process.
      this.app.error('Unhandled IR MQTT message error', error);
    }
  }

  onMessage(topic, payload) {
    const config = this.getConfig();
    if (topic !== config.topics.received) return;

    let message;
    try {
      message = JSON.parse(payload.toString());
    } catch (error) {
      this.app.error('Invalid IR MQTT JSON', error);
      return;
    }

    if (!message || typeof message !== 'object') {
      this.app.error('Invalid IR MQTT message: expected a JSON object');
      return;
    }

    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const pending = requestId ? this.pendingLearn.get(requestId) : null;
    if (!pending) {
      this.app.debugLog(`MQTT IR response ignored: no pending request ${requestId || '<missing>'}`);
      return;
    }

    try {
      const code = this.validateCode(message);
      this.finishPendingLearn(requestId);
      this.app.debugLog(`MQTT IR response received: requestId=${requestId}, format=${code.format}`);
      if (code.format === 'pronto') {
        this.app.debugLog(`MQTT learned ProntoHex: ${code.code}`);
      } else {
        this.app.debugLog(`MQTT learned raw IR: carrier=${code.carrier}Hz, code=${code.code.join(',')}`);
      }
      pending.resolve(code);
    } catch (error) {
      this.finishPendingLearn(requestId);
      const messageText = error && error.message ? error.message : String(error);
      this.app.error(`Invalid IR MQTT response for request ${requestId}: ${messageText}`);
      pending.reject(new Error(`Invalid IR signal received: ${messageText}`));
    }
  }

  finishPendingLearn(requestId) {
    const pending = this.pendingLearn.get(requestId);
    if (!pending) return null;
    this.app.homey.clearTimeout(pending.timer);
    this.pendingLearn.delete(requestId);
    return pending;
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
