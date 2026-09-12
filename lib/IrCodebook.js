'use strict';

const TIMING_LEVEL_COUNT = 32;
const MIN_TIMING_US = 5;
const MAX_TIMING_US = 32767;
const MAX_RELATIVE_TIMING_ERROR = 0.20;
const CARRIER_BUCKETS = Object.freeze([
  30000, 32000, 34000, 36000, 38000, 40000, 42000, 44000,
  46000, 48000, 50000, 52000, 54000, 56000, 58000,
]);
const MAX_CARRIER_ERROR_HZ = 1000;

function buildTimingLevels() {
  const ratio = MAX_TIMING_US / MIN_TIMING_US;
  const levels = [];

  for (let index = 0; index < TIMING_LEVEL_COUNT; index += 1) {
    const fraction = index / (TIMING_LEVEL_COUNT - 1);
    const value = Math.round(MIN_TIMING_US * (ratio ** fraction));
    if (levels.length > 0 && value <= levels.at(-1)) {
      throw new Error('IR timing quantizer generated duplicate or unordered levels');
    }
    levels.push(value);
  }

  return Object.freeze(levels);
}

const TIMING_LEVELS = buildTimingLevels();

function buildWords() {
  const words = [];
  for (const mark of TIMING_LEVELS) {
    for (const space of TIMING_LEVELS) {
      words.push([mark, space]);
    }
  }
  return words;
}

function signalIdForCarrier(carrier) {
  return `dynamic_codebook_${carrier}`;
}

function selectCarrier(carrier) {
  if (!Number.isInteger(carrier)) throw new Error('Raw IR carrier must be an integer');

  let best = null;
  for (const candidate of CARRIER_BUCKETS) {
    const error = Math.abs(carrier - candidate);
    if (!best || error < best.error) best = { carrier: candidate, error };
  }

  if (!best || best.error > MAX_CARRIER_ERROR_HZ) {
    throw new Error(`No IR carrier codebook is close enough to ${carrier} Hz`);
  }

  return {
    carrier: best.carrier,
    carrierErrorHz: best.error,
    signalId: signalIdForCarrier(best.carrier),
  };
}

function findTimingLevel(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('IR timing must be a positive integer');
  }

  let best = null;
  TIMING_LEVELS.forEach((candidate, index) => {
    const error = Math.abs(value - candidate) / value;
    if (!best || error < best.error) best = { index, value: candidate, error };
  });

  if (!best || best.error > MAX_RELATIVE_TIMING_ERROR) {
    throw new Error(`IR timing ${value} us cannot be represented by the codebook`);
  }

  return best;
}

function encodePair(mark, space) {
  const markMatch = findTimingLevel(mark);
  const spaceMatch = findTimingLevel(space);
  return {
    index: (markMatch.index * TIMING_LEVEL_COUNT) + spaceMatch.index,
    word: [markMatch.value, spaceMatch.value],
    markError: markMatch.error,
    spaceError: spaceMatch.error,
  };
}

module.exports = {
  CARRIER_BUCKETS,
  MAX_CARRIER_ERROR_HZ,
  MAX_RELATIVE_TIMING_ERROR,
  MAX_TIMING_US,
  MIN_TIMING_US,
  TIMING_LEVEL_COUNT,
  TIMING_LEVELS,
  buildWords,
  encodePair,
  findTimingLevel,
  selectCarrier,
  signalIdForCarrier,
};
