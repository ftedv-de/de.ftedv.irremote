'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrCodeConverter = require('../lib/IrCodeConverter');
const IrSignalEncoder = require('../lib/IrSignalEncoder');
const IrCodebookEncoder = require('../lib/IrCodebookEncoder');
const {
  CARRIER_BUCKETS,
  MAX_RELATIVE_TIMING_ERROR,
  TIMING_LEVELS,
  buildWords,
  signalIdForCarrier,
} = require('../lib/IrCodebook');

const legacyEncoder = new IrSignalEncoder({
  carrier: 38000,
  words: [
    [4707, 4523],
    [605, 552],
    [605, 1683],
    [579, 10124],
  ],
  timingTolerance: 0.25,
  carrierToleranceHz: 1500,
});
const codebookEncoder = new IrCodebookEncoder();

function prontoFor32BitValue(value) {
  const words = ['0000', '006D', '0022', '0000', '00B3', '00AC'];
  const bits = value.toString(2).padStart(32, '0');
  for (const bit of bits) {
    words.push('0017', bit === '1' ? '0040' : '0015');
  }
  words.push('0016', '0181');
  return words.join(' ');
}

const ON_PRONTO = prontoFor32BitValue(0x3A8EC00B);
const OFF_PRONTO = prontoFor32BitValue(0x8A8EC0A3);

test('known 32-bit Pronto fixtures have the declared 34 pairs', () => {
  assert.equal(ON_PRONTO.split(' ').length, 72);
  assert.equal(OFF_PRONTO.split(' ').length, 72);
});

test('legacy encoder still converts the proven ON ProntoHex frame', () => {
  const raw = IrCodeConverter.prontoHexToRaw(ON_PRONTO);
  const frame = legacyEncoder.encode(raw);
  assert.equal(raw.carrier, 38029);
  assert.equal(frame.length, 34);
});

test('generic codebook contains a full 32 by 32 timing matrix', () => {
  const words = buildWords();
  assert.equal(TIMING_LEVELS.length, 32);
  assert.equal(words.length, 1024);
  assert.deepEqual(words[0], [5, 5]);
  assert.deepEqual(words.at(-1), [32767, 32767]);
});

test('generated carrier profiles exactly match the runtime codebook', () => {
  const words = buildWords();
  for (const carrier of CARRIER_BUCKETS) {
    const signal = require(`../.homeycompose/signals/ir/${signalIdForCarrier(carrier)}.json`);
    assert.equal(signal.carrier, carrier);
    assert.equal(signal.dutyCycle, 33);
    assert.equal(signal.words.length, 1024);
    assert.deepEqual(signal.words, words);
  }
});

test('generic codebook encodes proven ON and OFF frames at 38 kHz', () => {
  for (const pronto of [ON_PRONTO, OFF_PRONTO]) {
    const raw = IrCodeConverter.prontoHexToRaw(pronto);
    const encoded = codebookEncoder.encode(raw);
    assert.equal(encoded.carrier, 38000);
    assert.equal(encoded.carrierErrorHz, 29);
    assert.equal(encoded.signalId, 'dynamic_codebook_38000');
    assert.equal(encoded.frame.length, 34);
    assert.ok(encoded.quantization.maxTimingError <= MAX_RELATIVE_TIMING_ERROR);
  }
});

test('carrier selection uses the nearest 2 kHz profile', () => {
  const encoded = codebookEncoder.encode({
    carrier: 55900,
    intro: [600, 500],
    repeat: [],
  });
  assert.equal(encoded.carrier, 56000);
  assert.equal(encoded.carrierErrorHz, 100);
  assert.equal(encoded.signalId, 'dynamic_codebook_56000');
});

test('terminal spaces above Homey timing limit are safely clamped', () => {
  const encoded = codebookEncoder.encode({
    carrier: 38000,
    intro: [9000, 4500, 560, 90000],
    repeat: [],
  });
  assert.equal(encoded.frame.length, 2);
  assert.equal(encoded.quantization.terminalSpaceClamped, true);
});

test('oversized spaces inside a frame are rejected', () => {
  assert.throws(
    () => codebookEncoder.encode({
      carrier: 38000,
      intro: [560, 90000, 560, 560],
      repeat: [],
    }),
    /exceeds Homey's 32767 us limit inside the frame/,
  );
});

test('Pronto repeat sections are expanded when repetitions are requested', () => {
  const encoded = codebookEncoder.encode({
    carrier: 38000,
    intro: [9000, 4500, 560, 560],
    repeat: [9000, 2250, 560, 20000],
  }, 3);
  assert.equal(encoded.frame.length, 6);
  assert.equal(encoded.txRepetitions, 1);
});

test('raw codes without a repeat section keep firmware repetitions', () => {
  const encoded = codebookEncoder.encode({
    carrier: 38000,
    intro: [9000, 4500, 560, 560],
    repeat: [],
  }, 3);
  assert.equal(encoded.frame.length, 2);
  assert.equal(encoded.txRepetitions, 3);
});

test('repairs exactly one missing terminal Pronto space', () => {
  const truncated = OFF_PRONTO.split(' ').slice(0, -1).join(' ');
  const raw = IrCodeConverter.prontoHexToRaw(truncated);
  const normalized = IrCodeConverter.normalizeCode({ format: 'pronto', code: truncated });

  assert.equal(raw.terminalSpaceSynthesized, true);
  assert.equal(raw.intro.length, 68);
  assert.ok(Math.abs(raw.intro.at(-1) - 32767) <= 20);
  assert.equal(normalized.code.split(' ').length, 72);
});

test('rejects ProntoHex with more than the terminal space missing', () => {
  assert.throws(
    () => IrCodeConverter.prontoHexToRaw(OFF_PRONTO.split(' ').slice(0, -2).join(' ')),
    /length mismatch/,
  );
});
