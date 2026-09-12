'use strict';

const mqtt = require('mqtt');
const { randomUUID } = require('crypto');
const IrLearnConsensus = require('./IrLearnConsensus');

const DEFAULT_TOPICS = {
  learn: 'homey/ir/learn',
  learnStop: 'homey/ir/learn/stop',
  received: 'homey/ir/received',
};
const DEFAULT_PRESS_GAP_MS = 250;
const DEFAULT_MAX_FRAMES = 100;

module.exports = class MqttService {

  constructor(app) {
    this.app = app;
    this.client = null;
    this.pendingLearn = new Map();
    this.learnConsensus = new IrLearnConsensus();
    this.pressGapMs = DEFAULT_PRESS_GAP_MS;
    this.maxFrames = DEFAULT_MAX_FRAMES;
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
      if (pending.sessionTimer) this.app.homey.clearTimeout(pending.sessionTimer);
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
        reject(new Error('No stable IR button sequence was received within 30 seconds'));
      }, timeout);
      this.pendingLearn.set(requestId, {
        resolve,
        reject,
        timer,
        sessionTimer: null,
        frameCount: 0,
        sessions: [],
        currentSession: [],
        seenCaptureIndexes: new Set(),
      });
    });

    try {
      await this.publish(config.topics.learn, {
        requestId,
        maxPresses: this.learnConsensus.maxCaptures,
        requiredMatches: this.learnConsensus.requiredMatches,
        maxFrames: this.maxFrames,
      });
      this.app.debugLog(
        `MQTT learn request published: ${requestId}; `
        + `collecting ${this.learnConsensus.maxCaptures} button presses, `
        + `need ${this.learnConsensus.requiredMatches} matching sequences`,
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

    pending.frameCount += 1;
    if (pending.frameCount > this.maxFrames) {
      this.finishPendingLearn(requestId);
      pending.reject(new Error('IR learning stopped because too many frames were received'));
      return;
    }

    try {
      const capture = this.learnConsensus.createCapture(message);
      const receivedAtMs = Number.isFinite(Number(message.receivedAtMs))
        ? Number(message.receivedAtMs)
        : Date.now();
      pending.currentSession.push({ capture, receivedAtMs });
      this.app.debugLog(
        `MQTT IR frame received: requestId=${requestId}, frame=${pending.frameCount}, `
        + `press=${pending.sessions.length + 1}, pressFrames=${pending.currentSession.length}`,
      );
    } catch (error) {
      const messageText = error && error.message ? error.message : String(error);
      this.app.error(
        `Invalid IR MQTT frame for request ${requestId} `
        + `(frame ${pending.frameCount}/${this.maxFrames}): ${messageText}`,
      );
      return;
    }

    if (pending.sessionTimer) this.app.homey.clearTimeout(pending.sessionTimer);
    pending.sessionTimer = this.app.homey.setTimeout(
      () => this.finalizeCurrentSession(requestId),
      this.pressGapMs,
    );
  }

  finalizeCurrentSession(requestId) {
    const pending = this.pendingLearn.get(requestId);
    if (!pending || pending.currentSession.length === 0) return;

    if (pending.sessionTimer) this.app.homey.clearTimeout(pending.sessionTimer);
    pending.sessionTimer = null;
    pending.sessions.push(pending.currentSession);
    pending.currentSession = [];

    this.app.debugLog(
      `MQTT IR button press completed: requestId=${requestId}, `
      + `press=${pending.sessions.length}/${this.learnConsensus.maxCaptures}, `
      + `frames=${pending.sessions[pending.sessions.length - 1].length}`,
    );

    if (pending.sessions.length < this.learnConsensus.maxCaptures) return;

    const sequence = this.findSequenceConsensus(pending.sessions);
    this.finishPendingLearn(requestId);
    if (!sequence) {
      pending.reject(new Error(
        'IR signal could not be learned reliably: fewer than '
        + `${this.learnConsensus.requiredMatches} button presses contained a matching sequence`,
      ));
      return;
    }

    this.app.debugLog(
      `MQTT IR sequence consensus reached: requestId=${requestId}, `
      + `presses=${pending.sessions.length}, frames=${sequence.frames.length}`,
    );
    pending.resolve(sequence);
  }

  findSequenceConsensus(sessions) {
    if (!Array.isArray(sessions) || sessions.length < this.learnConsensus.requiredMatches) return null;
    const maxLength = Math.max(...sessions.map((session) => session.length));

    for (let length = maxLength; length >= 1; length -= 1) {
      const candidates = sessions.filter((session) => session.length >= length);
      if (candidates.length < this.learnConsensus.requiredMatches) continue;

      const frames = [];
      let valid = true;
      for (let index = 0; index < length; index += 1) {
        const consensus = this.learnConsensus.findConsensus(
          candidates.map((session) => session[index].capture),
          { allowVariablePayload: candidates.length >= this.learnConsensus.fallbackMinCaptures },
        );
        if (!consensus) {
          valid = false;
          break;
        }

        const delayAfterMs = index < length - 1
          ? this.medianInterFrameGap(candidates, index)
          : 0;
        frames.push({
          code: consensus.capture.code,
          delayAfterMs,
        });
      }
      if (valid) return { format: 'sequence', frames };
    }

    return null;
  }

  medianInterFrameGap(sessions, index) {
    const gaps = sessions.map((session) => {
      const current = session[index];
      const next = session[index + 1];
      const elapsed = MqttService.elapsedMs(current.receivedAtMs, next.receivedAtMs);
      const nextDurationMs = next.capture.raw.code.reduce(
        (sum, timing) => sum + Math.abs(timing),
        0,
      ) / 1000;
      return Math.max(0, Math.round(elapsed - nextDurationMs));
    });
    return Math.min(5000, Math.round(IrLearnConsensus.median(gaps)));
  }

  finishPendingLearn(requestId) {
    const pending = this.pendingLearn.get(requestId);
    if (!pending) return null;
    this.app.homey.clearTimeout(pending.timer);
    if (pending.sessionTimer) this.app.homey.clearTimeout(pending.sessionTimer);
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

  static elapsedMs(start, end) {
    const elapsed = end - start;
    if (elapsed >= 0) return elapsed;
    if (start >= 0 && end >= 0 && start <= 0xFFFFFFFF && end <= 0xFFFFFFFF) {
      return elapsed + 0x100000000;
    }
    return 0;
  }

};
