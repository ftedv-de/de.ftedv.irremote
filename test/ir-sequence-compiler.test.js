'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrSequenceCompiler = require('../lib/IrSequenceCompiler');

function raw(code, carrier = 38000) {
  return { format: 'raw', carrier, code };
}

test('sequence compiler splits long learned silence into Homey timing buckets', () => {
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
    code: [9000, 4500, 560, 32767, 5, 6228, 9000, 2250, 560, 10000],
  });
});

test('pause bucket filler marks preserve the requested elapsed gap', () => {
  const pause = IrSequenceCompiler.encodePause(560, 70000);
  let elapsed = 0;
  for (let index = 1; index < pause.length; index += 2) {
    elapsed += pause[index];
    if (index + 1 < pause.length) elapsed += pause[index + 1];
  }

  assert.equal(elapsed, 70000);
  assert.ok(pause.filter((_, index) => index % 2 === 1).every((space) => space <= 32767));
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

test('sequence compiler falls back when too many pause buckets would exceed frame size', () => {
  const compiled = IrSequenceCompiler.compile({
    format: 'sequence',
    frames: [
      { code: raw([560, 30000]), delayAfterMs: 5000 },
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
