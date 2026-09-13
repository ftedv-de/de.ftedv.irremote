'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrEspHomeEncoder = require('../lib/IrEspHomeEncoder');

test('encodes a single raw frame as signed ESPHome timings', () => {
  assert.deepEqual(IrEspHomeEncoder.encode({
    format: 'raw',
    carrier: 38000,
    code: [9000, 4500, 560, 560],
  }, 2), {
    version: 1,
    carrier: 38000,
    repetitions: 2,
    timings: [9000, -4500, 560, -560],
  });
});

test('folds sequence delay into the previous terminal space', () => {
  const payload = IrEspHomeEncoder.encode({
    format: 'sequence',
    frames: [
      {
        code: {
          format: 'raw',
          carrier: 38000,
          code: [9000, 4500, 560, 10000],
        },
        delayAfterMs: 29,
      },
      {
        code: {
          format: 'raw',
          carrier: 38000,
          code: [9000, 2250, 560, 10000],
        },
        delayAfterMs: 0,
      },
    ],
  });

  assert.equal(payload.carrier, 38000);
  assert.deepEqual(payload.timings, [
    9000, -4500, 560, -39000,
    9000, -2250, 560, -10000,
  ]);
});

test('rejects mixed-carrier ESPHome sequences', () => {
  assert.throws(() => IrEspHomeEncoder.encode({
    format: 'sequence',
    frames: [
      {
        code: { format: 'raw', carrier: 38000, code: [500, 500] },
        delayAfterMs: 10,
      },
      {
        code: { format: 'raw', carrier: 40000, code: [500, 500] },
        delayAfterMs: 0,
      },
    ],
  }), /same carrier/);
});
