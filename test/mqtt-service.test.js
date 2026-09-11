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
    debugLog() {},
    error(...args) {
      this.errors.push(args);
    },
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

test('invalid learned IR response rejects only the matching pending request', async () => {
  const app = createApp();
  const service = new MqttService(app);
  const requestId = 'test-request';
  let rejectedError;

  service.pendingLearn.set(requestId, {
    timer: setTimeout(() => {}, 10000),
    resolve() {
      throw new Error('must not resolve');
    },
    reject(error) {
      rejectedError = error;
    },
  });

  assert.doesNotThrow(() => {
    service.handleMessage('homey/ir/received', Buffer.from(JSON.stringify({
      requestId,
      format: 'pronto',
      code: '0000 006D 0022 0000 00B3',
    })));
  });

  assert.equal(service.pendingLearn.size, 0);
  assert.ok(rejectedError instanceof Error);
  assert.match(rejectedError.message, /Invalid IR signal received/);
});
