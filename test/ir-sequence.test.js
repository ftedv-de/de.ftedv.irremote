'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrSequence = require('../lib/IrSequence');

const PRONTO = '0000 006D 0002 0000 015D 0057 0016 0181';

test('legacy single codes stay compatible', () => {
  const code = IrSequence.normalize({ format: 'pronto', code: PRONTO });
  assert.equal(code.format, 'pronto');
  assert.equal(code.code, PRONTO);
});

test('sequence normalizes frames and delays', () => {
  const sequence = IrSequence.normalize({
    format: 'sequence',
    frames: [
      { code: { format: 'pronto', code: PRONTO }, delayAfterMs: 108.4 },
      { code: { format: 'raw', carrier: 38000, code: [9000, 2250, 560, 10000] } },
    ],
  });

  assert.equal(sequence.format, 'sequence');
  assert.equal(sequence.frames.length, 2);
  assert.equal(sequence.frames[0].delayAfterMs, 108);
  assert.equal(sequence.frames[1].delayAfterMs, 0);
});

test('sequence clone is independent from its source', () => {
  const source = {
    format: 'sequence',
    frames: [
      {
        code: { format: 'raw', carrier: 38000, code: [9000, 2250, 560, 10000] },
        delayAfterMs: 80,
      },
    ],
  };
  const copy = IrSequence.clone(source);
  copy.frames[0].code.code[0] = 1;

  assert.equal(source.frames[0].code.code[0], 9000);
});

test('sequence rejects invalid delays', () => {
  assert.throws(() => IrSequence.normalize({
    format: 'sequence',
    frames: [
      { code: { format: 'pronto', code: PRONTO }, delayAfterMs: 6000 },
    ],
  }), /delays must be between/);
});
