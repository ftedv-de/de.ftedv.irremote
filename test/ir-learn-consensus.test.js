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
