'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const IrCodeConverter = require('../lib/IrCodeConverter');
const IrSignalEncoder = require('../lib/IrSignalEncoder');
const wordIndexTestSignal64 = require('../.homeycompose/signals/ir/word_index_test_64.json');
const wordIndexTestSignal256 = require('../.homeycompose/signals/ir/word_index_test_256.json');
const wordIndexTestSignal512 = require('../.homeycompose/signals/ir/word_index_test_512.json');
const wordIndexTestSignal1024 = require('../.homeycompose/signals/ir/word_index_test_1024.json');

const encoder = new IrSignalEncoder({
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

const ON_PRONTO = '0000 006D 0022 0000 00B3 00AC 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0040 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0040 0016 0181';
const OFF_PRONTO = '0000 006D 0022 0000 00B3 00AC 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0017 0040 0017 0015 0017 0040 0017 0040 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0015 0017 0040 0017 0015 0017 0040 0017 0015 0017 0015 0017 0015 0017 0040 0017 0040 0016 0181';

test('converts and encodes proven ON ProntoHex frame', () => {
  const raw = IrCodeConverter.prontoHexToRaw(ON_PRONTO);
  const frame = encoder.encode(raw);

  assert.equal(raw.carrier, 38029);
  assert.equal(frame.length, 34);
  assert.deepEqual(frame.slice(0, 4), [0, 1, 1, 2]);
  assert.equal(frame.at(-1), 3);
});

test('converts and encodes proven OFF ProntoHex frame', () => {
  const raw = IrCodeConverter.prontoHexToRaw(OFF_PRONTO);
  const frame = encoder.encode(raw);

  assert.equal(raw.carrier, 38029);
  assert.equal(frame.length, 34);
  assert.deepEqual(frame.slice(0, 4), [0, 2, 1, 1]);
  assert.equal(frame.at(-1), 3);
});

test('rejects truncated ProntoHex instead of silently sending it', () => {
  assert.throws(
    () => IrCodeConverter.prontoHexToRaw(OFF_PRONTO.split(' ').slice(0, -1).join(' ')),
    /length mismatch/,
  );
});

test('rejects timings outside the registered word codebook', () => {
  assert.throws(
    () => encoder.timingsToFrame([4707, 4523, 900, 2500, 579, 10124]),
    /Unsupported IR timing pair/,
  );
});

test('64-word diagnostic signal exposes word index 63', () => {
  assert.equal(wordIndexTestSignal64.words.length, 64);
  assert.deepEqual(wordIndexTestSignal64.words[0], [4707, 4523]);
  assert.deepEqual(wordIndexTestSignal64.words[63], [605, 552]);
});

test('256-word diagnostic signal exposes word index 255', () => {
  assert.equal(wordIndexTestSignal256.words.length, 256);
  assert.deepEqual(wordIndexTestSignal256.words[0], [4707, 4523]);
  assert.deepEqual(wordIndexTestSignal256.words[255], [605, 552]);
});

test('512-word diagnostic signal exposes word index 511', () => {
  assert.equal(wordIndexTestSignal512.words.length, 512);
  assert.deepEqual(wordIndexTestSignal512.words[0], [4707, 4523]);
  assert.deepEqual(wordIndexTestSignal512.words[511], [605, 552]);
});

test('1024-word diagnostic signal exposes word index 1023', () => {
  assert.equal(wordIndexTestSignal1024.words.length, 1024);
  assert.deepEqual(wordIndexTestSignal1024.words[0], [4707, 4523]);
  assert.deepEqual(wordIndexTestSignal1024.words[1023], [605, 552]);
});
