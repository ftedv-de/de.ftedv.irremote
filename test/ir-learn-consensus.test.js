'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrLearnConsensus = require('../lib/IrLearnConsensus');

function capture(consensus, timings, carrier = 38000) {
  return consensus.createCapture({
    format: 'raw',
    carrier,
    code: timings,
  });
}

function binaryTimings(bits, jitter = 0, mark = 560) {
  const timings = [9000 + jitter, 4500];
  for (const bit of bits) {
    timings.push(mark, bit === '1' ? 1690 + jitter : 560 + jitter);
  }
  timings.push(mark, 10000);
  return timings;
}

function binaryCapture(consensus, bits, jitter = 0, mark = 560) {
  return capture(consensus, binaryTimings(bits, jitter, mark));
}

const A = [9000, 4500, 560, 560, 560, 1690, 560, 10000];
const A_JITTER_1 = [8900, 4400, 575, 550, 550, 1660, 570, 12000];
const A_JITTER_2 = [9150, 4600, 545, 575, 570, 1710, 550, 8000];
const B = [9000, 4500, 560, 1690, 560, 1690, 560, 10000];
const B_JITTER = [9050, 4550, 550, 1660, 570, 1710, 555, 9000];

test('three timing-similar captures form consensus despite normal jitter', () => {
  const consensus = new IrLearnConsensus();
  const captures = [
    capture(consensus, A),
    capture(consensus, A_JITTER_1),
    capture(consensus, A_JITTER_2),
  ];

  const result = consensus.findConsensus(captures);
  assert.ok(result);
  assert.equal(result.clusterSize, 3);
  assert.equal(result.mode, 'exact');
  assert.ok(captures.includes(result.capture));
});

test('toggle variants remain separate and A/B/A/B/A still reaches 3-of-5 consensus', () => {
  const consensus = new IrLearnConsensus();
  const captures = [
    capture(consensus, A),
    capture(consensus, B),
    capture(consensus, A_JITTER_1),
    capture(consensus, B_JITTER),
    capture(consensus, A_JITTER_2),
  ];

  assert.equal(consensus.areSimilar(captures[0], captures[1]), false);
  const result = consensus.findConsensus(captures);
  assert.ok(result);
  assert.equal(result.clusterSize, 3);
  assert.equal(result.mode, 'exact');
  assert.equal(consensus.areSimilar(result.capture, captures[0]), true);
});

test('a badly distorted first capture does not poison later consensus', () => {
  const consensus = new IrLearnConsensus();
  const distorted = [18000, 4500, 560, 560, 560, 1690, 560, 10000];
  const captures = [
    capture(consensus, distorted),
    capture(consensus, A),
    capture(consensus, A_JITTER_1),
    capture(consensus, A_JITTER_2),
  ];

  const result = consensus.findConsensus(captures);
  assert.ok(result);
  assert.equal(result.clusterSize, 3);
  assert.equal(consensus.areSimilar(result.capture, captures[0]), false);
});

test('final idle-space variation alone does not split otherwise identical captures', () => {
  const consensus = new IrLearnConsensus();
  const shortTail = capture(consensus, [9000, 4500, 560, 560, 560, 1690, 560, 4000]);
  const longTail = capture(consensus, [9000, 4500, 560, 560, 560, 1690, 560, 32767]);
  assert.equal(consensus.areSimilar(shortTail, longTail), true);
});

test('five structurally equal binary frames may fall back to a real medoid with a few variable bits', () => {
  const consensus = new IrLearnConsensus();
  const base = '01011010010000001000000101110101';
  const variants = [
    '01011010010000001000000101110101',
    '01011010010000000100000001111010',
    '01011010010000000000000001110101',
    '01011010010000001000000101110101',
    '01011010010000001000000011110101',
  ];
  const captures = variants.map((bits, index) => binaryCapture(consensus, bits, index % 2));

  assert.equal(consensus.findConsensus(captures.slice(0, 4)), null);
  const result = consensus.findConsensus(captures);
  assert.ok(result);
  assert.equal(result.mode, 'variable-payload');
  assert.ok(result.support >= 4);
  assert.ok(captures.includes(result.capture));
  assert.equal(consensus.payloadBitDistance(result.capture, binaryCapture(consensus, base)), 0);
  assert.equal(result.bitDistance, result.totalBitDistance);
  assert.ok(result.maxBitDistance <= consensus.fallbackMaxDifferingBits);
  assert.equal(result.averageBitDistance, result.totalBitDistance / (result.support - 1));
});

test('variable-payload fallback can be enabled after five attempts with only four valid captures', () => {
  const consensus = new IrLearnConsensus();
  const variants = [
    '01011010010000001000000101110101',
    '11011010010000001000000101110101',
    '00011010010000001000000101110101',
    '01111010010000001000000101110101',
  ];
  const captures = variants.map((bits) => binaryCapture(consensus, bits));

  assert.equal(consensus.findConsensus(captures), null);
  const result = consensus.findConsensus(captures, { allowVariablePayload: true });
  assert.ok(result);
  assert.equal(result.mode, 'variable-payload');
  assert.equal(result.support, 4);
});

test('payload comparison includes the final payload bit', () => {
  const consensus = new IrLearnConsensus();
  const left = binaryCapture(consensus, '01010101010101010101010101010100');
  const right = binaryCapture(consensus, '01010101010101010101010101010101');
  assert.equal(consensus.payloadBitDistance(left, right), 1);
});

test('variable-payload fallback rejects a different pulse-mark shape', () => {
  const consensus = new IrLearnConsensus();
  const bits = '01011010010000001000000101110101';
  const normal = binaryCapture(consensus, bits, 0, 560);
  const differentMarks = binaryCapture(consensus, bits, 0, 1000);
  assert.equal(consensus.hasCompatiblePulseShape(normal, differentMarks), false);
  assert.equal(consensus.payloadBitDistance(normal, differentMarks), Number.POSITIVE_INFINITY);
});

test('variable-payload fallback refuses unrelated frames', () => {
  const consensus = new IrLearnConsensus();
  const variants = [
    '00000000000000000000000000000000',
    '11111111111111111111111111111111',
    '10101010101010101010101010101010',
    '01010101010101010101010101010101',
    '00110011001100110011001100110011',
  ];
  const captures = variants.map((bits) => binaryCapture(consensus, bits));
  assert.equal(consensus.findConsensus(captures), null);
});
