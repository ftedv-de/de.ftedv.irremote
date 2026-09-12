'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrSequenceCompiler = require('../lib/IrSequenceCompiler');

function raw(code, carrier = 38000) {
  return { format: 'raw', carrier, code };
}

test('sequence compiler folds learned delay into the preceding terminal space', () => {
  const compiled = IrSequenceCompiler.compile({
    format: 'sequence',
    frames: [
      {
        code: raw([9000, 4500, 560, 10000]),
        delayAfterMs: 29,
      },
      {
        code: raw([9000, 2250, 560, 10000]),
        delayAfterMs: 0,
      },
    ],
  });

  assert.deepEqual(compiled, {
    format: 'raw',
    carrier: 38000,
    code: [9000, 4500, 560, 39000, 9000, 2250, 560, 10000],
  });
});

test('sequence compiler keeps zero-delay frames in one transmission', () => {
  const compiled = IrSequenceCompiler.compile({
    format: 'sequence',
    frames: [
      { code: raw([560, 10000]), delayAfterMs: 0 },
      { code: raw([9000, 2250]), delayAfterMs: 0 },
    ],
  });

  assert.deepEqual(compiled.code, [560, 10000, 9000, 2250]);
});

test('sequence compiler falls back when the combined silence exceeds the codebook', () => {
  const compiled = IrSequenceCompiler.compile({
    format: 'sequence',
    frames: [
      { code: raw([560, 30000]), delayAfterMs: 21 },
      { code: raw([560, 560]), delayAfterMs: 0 },
    ],
  });

  assert.equal(compiled, null);
});

test('sequence compiler falls back when frames require different carrier profiles', () => {
  const compiled = IrSequenceCompiler.compile({
    format: 'sequence',
    frames: [
      { code: raw([560, 10000], 38000), delayAfterMs: 10 },
      { code: raw([560, 10000], 56000), delayAfterMs: 0 },
    ],
  });

  assert.equal(compiled, null);
});
