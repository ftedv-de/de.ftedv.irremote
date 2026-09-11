'use strict';

const mqtt = require('mqtt');
const { randomUUID } = require('crypto');
const IrLearnConsensus = require('./IrLearnConsensus');

const DEFAULT_TOPICS = {
  learn: 'homey/ir/learn',
  learnStop: 'homey/ir/learn/stop',
  received: 'homey/ir/received',
};

module.exports = class MqttService {

  constructor(app) {
    this.app = app;
    this.client = null;
    this.pendingLearn = new Map();
    this.learnConsensus = new IrLearnConsensus();
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
        this.stopRemoteLearning(requestId);
        reject(new Error('No stable IR signal consensus was received within 30 seconds'));
      }, timeout);
      this.pendingLearn.set(requestId, {
        resolve,
        reject,
        timer,
        attempts: 0,
        captures: [],
        seenCaptureIndexes: new Set(),
      });
    });

    try {
      await this.publish(config.topics.learn, {
        requestId,
        maxCaptures: this.learnConsensus.maxCaptures,
        requiredMatches: this.learnConsensus.requiredMatches,
      });
      this.app.debugLog(
        `MQTT learn request published: ${requestId}; `
        + `need ${this.learnConsensus.requiredMatches}/${this.learnConsensus.maxCaptures} matching captures`,
      );
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

    const captureIndex = Number(message.captureIndex);
    if (Number.isInteger(captureIndex) && captureIndex > 0) {
      if (pending.seenCaptureIndexes.has(captureIndex)) {
        this.app.debugLog(
          `MQTT IR duplicate capture ignored: requestId=${requestId}, captureIndex=${captureIndex}`,
        );
        return;
      }
      pending.seenCaptureIndexes.add(captureIndex);
    }

    pending.attempts += 1;

    try {
      const capture = this.learnConsensus.createCapture(message);
      pending.captures.push(capture);
      this.app.debugLog(
        `MQTT IR capture received: requestId=${requestId}, `
        + `attempt=${pending.attempts}/${this.learnConsensus.maxCaptures}, `
        + `valid=${pending.captures.length}`,
      );
    } catch (error) {
      const messageText = error && error.message ? error.message : String(error);
      this.app.error(
        `Invalid IR MQTT capture for request ${requestId} `
        + `(attempt ${pending.attempts}/${this.learnConsensus.maxCaptures}): ${messageText}`,
      );
    }

    const finalAttempt = pending.attempts >= this.learnConsensus.maxCaptures;
    const consensus = this.learnConsensus.findConsensus(pending.captures, {
      allowVariablePayload: finalAttempt,
    });

    if (consensus) {
      this.finishPendingLearn(requestId);
      const { code } = consensus.capture;
      const detail = consensus.mode === 'variable-payload'
        ? `, variablePayloadTotalBitDistance=${consensus.totalBitDistance}`
          + `, variablePayloadMaxBitDistance=${consensus.maxBitDistance}`
          + `, variablePayloadAverageBitDistance=${consensus.averageBitDistance.toFixed(2)}`
        : '';
      this.app.debugLog(
        `MQTT IR consensus reached: requestId=${requestId}, `
        + `mode=${consensus.mode || 'exact'}, matches=${consensus.clusterSize}, `
        + `attempts=${pending.attempts}${detail}`,
      );
      if (code.format === 'pronto') {
        this.app.debugLog(`MQTT learned ProntoHex: ${code.code}`);
      } else {
        this.app.debugLog(`MQTT learned raw IR: carrier=${code.carrier}Hz, code=${code.code.join(',')}`);
      }
      pending.resolve(code);
      return;
    }

    if (finalAttempt) {
      this.finishPendingLearn(requestId);
      pending.reject(new Error(
        `IR signal could not be learned reliably: fewer than `
        + `${this.learnConsensus.requiredMatches} of ${this.learnConsensus.maxCaptures} captures matched`,
      ));
    }
  }

  finishPendingLearn(requestId) {
    const pending = this.pendingLearn.get(requestId);
    if (!pending) return null;
    this.app.homey.clearTimeout(pending.timer);
    this.pendingLearn.delete(requestId);
    this.stopRemoteLearning(requestId);
    return pending;
  }

  stopRemoteLearning(requestId) {
    const config = this.getConfig();
    if (!this.client || !this.client.connected) return;

    try {
      this.publish(config.topics.learnStop, { requestId }).catch((error) => {
        this.app.error(`Failed to stop remote IR learning for ${requestId}`, error);
      });
    } catch (error) {
      this.app.error(`Failed to stop remote IR learning for ${requestId}`, error);
    }
  }

  validateCode(value) {
    return this.learnConsensus.createCapture(value).code;
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
