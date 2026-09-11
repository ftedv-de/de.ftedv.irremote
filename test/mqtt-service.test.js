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
    attempts: 0,
    captures: [],
    resolve(value) {
      resolvedValue = value;
    },
    reject(error) {
      rejectedError = error;
    },
    ...overrides,
  });
  return {
    get resolvedValue() { return resolvedValue; },
    get rejectedError() { return rejectedError; },
  };
}

test('malformed MQTT JSON never escapes the message handler', () => {
  const app = createApp();
  const service = new MqttService(app);

  assert.doesNotThrow(() => {
    service.handleMessage('homey/ir/received', Buffer.from('{not-json'));
  });
  assert.equal(app.errors.length, 1);
});

test('one invalid capture does not abort the active learning request', () => {
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

  assert.equal(service.pendingLearn.size, 1);
  assert.equal(service.pendingLearn.get(requestId).attempts, 1);
  assert.equal(result.rejectedError, undefined);
  assert.equal(app.errors.length, 1);

  clearTimeout(service.pendingLearn.get(requestId).timer);
});

test('five unusable captures reject only the matching learning request', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);

  const badPayload = Buffer.from(JSON.stringify({
    requestId,
    format: 'pronto',
    code: '0000 006D 0022 0000 00B3',
  }));

  for (let index = 0; index < 5; index += 1) {
    assert.doesNotThrow(() => service.handleMessage('homey/ir/received', badPayload));
  }

  assert.equal(service.pendingLearn.size, 0);
  assert.ok(result.rejectedError instanceof Error);
  assert.match(result.rejectedError.message, /could not be learned reliably/);
});

test('three matching valid captures resolve the learning request', () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  const result = addPending(service, requestId);

  const captures = [
    [9000, 4500, 560, 560, 560, 1690, 560, 10000],
    [8900, 4400, 575, 550, 550, 1660, 570, 12000],
    [9150, 4600, 545, 575, 570, 1710, 550, 8000],
  ];

  for (const code of captures) {
    service.handleMessage('homey/ir/received', Buffer.from(JSON.stringify({
      requestId,
      format: 'raw',
      carrier: 38000,
      code,
    })));
  }

  assert.equal(service.pendingLearn.size, 0);
  assert.equal(result.rejectedError, undefined);
  assert.ok(result.resolvedValue);
  assert.equal(result.resolvedValue.format, 'raw');
});
