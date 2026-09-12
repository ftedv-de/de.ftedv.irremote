'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MqttService = require('../lib/MqttService');

function createApp() {
  const settings = new Map([
    ['mqtt', {
      url: 'mqtt://example.invalid:1883',
      topics: {
        learn: 'homey/ir/learn',
        received: 'homey/ir/received',
      },
    }],
  ]);

  return {
    errors: [],
    debugs: [],
    homey: {
      settings: {
        get(key) {
          return settings.get(key);
        },
      },
      setTimeout,
      clearTimeout,
    },
    log() {},
    debugLog(...args) {
      this.debugs.push(args);
    },
    error(...args) {
      this.errors.push(args);
    },
  };
}

function addPending(service, requestId, overrides = {}) {
  let resolvedValue;
  let rejectedError;
  service.pendingLearn.set(requestId, {
    timer: setTimeout(() => {}, 10000),
    sessionTimer: null,
    frameCount: 0,
    sessions: [],
    currentSession: [],
    seenCaptureIndexes: new Set(),
    resolve(value) {
      resolvedValue = value;
    },
    reject(error) {
      rejectedError = error;
    },
    ...overrides,
  });
  return {
    get resolvedValue() {
      return resolvedValue;
    },
    get rejectedError() {
      return rejectedError;
    },
  };
}

function rawMessage(requestId, captureIndex, code, receivedAtMs, carrier = 38000) {
  return Buffer.from(JSON.stringify({
    requestId,
    captureIndex,
    receivedAtMs,
    format: 'raw',
    carrier,
    code,
  }));
}

function binaryTimings(bits) {
  const timings = [9000, 4500];
  for (const bit of bits) timings.push(560, bit === '1' ? 1690 : 560);
  timings.push(560, 10000);
  return timings;
}

test('malformed MQTT JSON never escapes the message handler', () => {
  const app = createApp();
  const service = new MqttService(app);

  assert.doesNotThrow(() => {
    service.handleMessage('homey/ir/received', Buffer.from('{not-json'));
  });
  assert.equal(app.errors.length, 1);
});

test('one invalid frame does not abort the active learning request', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);

  assert.doesNotThrow(() => {
    service.handleMessage('homey/ir/received', Buffer.from(JSON.stringify({
      requestId,
      format: 'pronto',
      code: '0000 006D 0022 0000 00B3',
    })));
  });

  const pending = service.pendingLearn.get(requestId);
  assert.equal(pending.frameCount, 1);
  assert.equal(pending.currentSession.length, 0);
  assert.equal(result.rejectedError, undefined);
  assert.equal(app.errors.length, 1);
  clearTimeout(pending.timer);
});

test('QoS1 duplicate frame indexes do not count as separate frames', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  addPending(service, requestId);

  const payload = rawMessage(
    requestId,
    1,
    [9000, 4500, 560, 560, 560, 1690, 560, 10000],
    1000,
  );

  service.handleMessage('homey/ir/received', payload);
  service.handleMessage('homey/ir/received', payload);
  service.handleMessage('homey/ir/received', payload);

  const pending = service.pendingLearn.get(requestId);
  assert.equal(pending.frameCount, 1);
  assert.equal(pending.currentSession.length, 1);
  clearTimeout(pending.sessionTimer);
  clearTimeout(pending.timer);
});

test('five matching button presses resolve to a one-frame sequence', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);
  const captures = [
    [9000, 4500, 560, 560, 560, 1690, 560, 10000],
    [8900, 4400, 575, 550, 550, 1660, 570, 12000],
    [9150, 4600, 545, 575, 570, 1710, 550, 8000],
    [9050, 4550, 555, 565, 565, 1680, 555, 9000],
    [8950, 4450, 565, 555, 555, 1700, 565, 11000],
  ];

  captures.forEach((code, index) => {
    service.handleMessage(
      'homey/ir/received',
      rawMessage(requestId, index + 1, code, 1000 + (index * 1000)),
    );
    service.finalizeCurrentSession(requestId);
  });

  assert.equal(service.pendingLearn.size, 0);
  assert.equal(result.rejectedError, undefined);
  assert.equal(result.resolvedValue.format, 'sequence');
  assert.equal(result.resolvedValue.frames.length, 1);
  assert.equal(result.resolvedValue.frames[0].code.format, 'raw');
});

test('multi-frame button presses preserve the stable frame sequence and gap', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);
  const full = [9000, 4500, 560, 560, 560, 1690, 560, 10000];
  const repeat = [9000, 2250, 560, 10000];

  for (let press = 0; press < 5; press += 1) {
    const base = 1000 + (press * 1000);
    service.handleMessage(
      'homey/ir/received',
      rawMessage(requestId, (press * 2) + 1, full, base),
    );
    service.handleMessage(
      'homey/ir/received',
      rawMessage(requestId, (press * 2) + 2, repeat, base + 110),
    );
    service.finalizeCurrentSession(requestId);
  }

  assert.equal(result.rejectedError, undefined);
  assert.equal(result.resolvedValue.frames.length, 2);
  assert.equal(result.resolvedValue.frames[0].delayAfterMs, 88);
  assert.equal(result.resolvedValue.frames[1].delayAfterMs, 0);
});

test('learner keeps the longest stable prefix present in at least three presses', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);
  const a = [9000, 4500, 560, 560, 560, 1690, 560, 10000];
  const b = [9000, 2250, 560, 10000];
  const c = [4500, 2250, 560, 10000];
  let captureIndex = 1;

  [3, 2, 3, 2, 3].forEach((length, press) => {
    const frames = [a, b, c].slice(0, length);
    frames.forEach((code, frame) => {
      service.handleMessage(
        'homey/ir/received',
        rawMessage(requestId, captureIndex, code, 1000 + (press * 1000) + (frame * 100)),
      );
      captureIndex += 1;
    });
    service.finalizeCurrentSession(requestId);
  });

  assert.equal(result.rejectedError, undefined);
  assert.equal(result.resolvedValue.frames.length, 3);
});

test('variable payload fallback still works across complete one-frame presses', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);
  const variants = [
    '01011010010000001000000101110101',
    '11011010010000001000000101110101',
    '00011010010000001000000101110101',
    '01111010010000001000000101110101',
    '01011010010000001000000101110101',
  ];

  variants.forEach((bits, index) => {
    service.handleMessage(
      'homey/ir/received',
      rawMessage(requestId, index + 1, binaryTimings(bits), 1000 + (index * 1000)),
    );
    service.finalizeCurrentSession(requestId);
  });

  assert.equal(result.rejectedError, undefined);
  assert.equal(result.resolvedValue.frames.length, 1);
});
