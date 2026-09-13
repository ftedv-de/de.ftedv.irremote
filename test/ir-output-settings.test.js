'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrOutputSettings = require('../lib/IrOutputSettings');

test('defaults existing remotes to Homey output', () => {
  assert.deepEqual(IrOutputSettings.fromDeviceSettings({}), {
    type: 'homey',
    mqttSendTopic: '',
  });
});

test('requires a publish topic for ESPHome output', () => {
  assert.throws(
    () => IrOutputSettings.validate({ type: 'esphome', mqttSendTopic: '   ' }),
    /required/,
  );
});

test('rejects MQTT wildcard topics for ESPHome output', () => {
  assert.throws(
    () => IrOutputSettings.validate({ type: 'esphome', mqttSendTopic: 'homey/ir/+' }),
    /must not contain/,
  );
  assert.throws(
    () => IrOutputSettings.validate({ type: 'esphome', mqttSendTopic: 'homey/ir/#' }),
    /must not contain/,
  );
});

test('normalizes and preserves an ESPHome send topic', () => {
  assert.deepEqual(IrOutputSettings.validate({
    type: 'esphome',
    mqttSendTopic: '  homey/ir/living-room/send  ',
  }), {
    type: 'esphome',
    mqttSendTopic: 'homey/ir/living-room/send',
  });
});
