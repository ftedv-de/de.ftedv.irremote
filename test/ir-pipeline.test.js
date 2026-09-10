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
const wordIndexTestSignal64 = require('../.homeycompose/signals/ir/word_index_test_64.json');
const wordIndexTestSignal256 = require('../.homeycompose/signals/ir/word_index_test_256.json');
const wordIndexTestSignal512 = require('../.homeycompose/signals/ir/word_index_test_512.json');
const wordIndexTestSignal1024 = require('../.homeycompose/signals/ir/word_index_test_1024.json');

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

const ON_PRONTO = '0000 006D 0022 0000 00B3 00AC 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0040 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0040 0016 0181';
const OFF_PRONTO = '0000 006D 0022 0000 00B3 00AC 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0040 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0016 0181';

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

test('rejects truncated ProntoHex instead of silently sending it', () => {
  assert.throws(
    () => IrCodeConverter.prontoHexToRaw(OFF_PRONTO.split(' ').slice(0, -1).join(' ')),
    /length mismatch/,
  );
});

test('64-word diagnostic signal exposes word index 63', () => {
  assert.equal(wordIndexTestSignal64.words.length, 64);
  assert.deepEqual(wordIndexTestSignal64.words[0], [4707, 4523]);
  assert.deepEqual(wordIndexTestSignal64.words[63], [605, 552]);
});

test('256-word diagnostic signal exposes word index 255', () => {
  assert.equal(wordIndexTestSignal256.words.length, 256);
  assert.deepEqual(wordIndexTestSignal256.words[255], [605, 552]);
});

test('512-word diagnostic signal exposes word index 511', () => {
  assert.equal(wordIndexTestSignal512.words.length, 512);
  assert.deepEqual(wordIndexTestSignal512.words[511], [605, 552]);
});

test('1024-word diagnostic signal exposes word index 1023', () => {
  assert.equal(wordIndexTestSignal1024.words.length, 1024);
  assert.deepEqual(wordIndexTestSignal1024.words[1023], [605, 552]);
});
