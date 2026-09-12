'use strict';

const IrCodeConverter = require('./IrCodeConverter');
const {
  MAX_TIMING_US,
  MIN_TIMING_US,
  selectCarrier,
} = require('./IrCodebook');

const MAX_COMPILED_PAIRS = 128;

class IrSequenceCompiler {

  static compile(sequence) {
    if (!sequence || sequence.format !== 'sequence' || !Array.isArray(sequence.frames)) {
      throw new Error('IR sequence is required');
    }
    if (sequence.frames.length === 0) throw new Error('IR sequence must contain at least one frame');

    const decoded = sequence.frames.map((frame) => ({
      frame,
      raw: IrCodeConverter.codeToRaw(frame.code),
    }));
    const selected = decoded.map(({ raw }) => selectCarrier(raw.carrier));
    const [{ signalId }] = selected;

    if (selected.some((entry) => entry.signalId !== signalId)) {
      return null;
    }

    const timings = [];
    for (let index = 0; index < decoded.length; index += 1) {
      const { frame, raw } = decoded[index];
      if (!Array.isArray(raw.code) || raw.code.length === 0 || raw.code.length % 2 !== 0) {
        return null;
      }

      const frameTimings = raw.code.map((timing) => Math.abs(timing));
      const terminalMark = frameTimings.at(-2);
      const terminalSpace = frameTimings.at(-1);
      if (terminalMark > MAX_TIMING_US) return null;

      timings.push(...frameTimings.slice(0, -2));

      if (index < decoded.length - 1) {
        const delayUs = Math.round(frame.delayAfterMs * 1000);
        const totalSilenceUs = terminalSpace + delayUs;
        const pausePairs = IrSequenceCompiler.encodePause(terminalMark, totalSilenceUs);
        if (!pausePairs) return null;
        timings.push(...pausePairs);
      } else {
        timings.push(terminalMark, terminalSpace);
      }

      if ((timings.length / 2) > MAX_COMPILED_PAIRS) return null;
    }

    return {
      format: 'raw',
      carrier: decoded[0].raw.carrier,
      code: timings,
    };
  }

  static encodePause(terminalMark, totalSilenceUs) {
    if (!Number.isInteger(terminalMark) || terminalMark <= 0
      || !Number.isInteger(totalSilenceUs) || totalSilenceUs <= 0) {
      return null;
    }
    if (terminalMark > MAX_TIMING_US) return null;
    if (totalSilenceUs <= MAX_TIMING_US) return [terminalMark, totalSilenceUs];

    // Homey limits every interval in a regular IR signal to 32767 us. Continue
    // a longer silence with the shortest possible mark (5 us) between buckets.
    // At 38 kHz this mark is shorter than one carrier cycle; the hardware test
    // determines whether it is effectively invisible to a demodulating receiver.
    const spaceCount = Math.ceil(
      (totalSilenceUs + MIN_TIMING_US) / (MAX_TIMING_US + MIN_TIMING_US),
    );
    const fillerMarkCount = spaceCount - 1;
    let remainingSpaceUs = totalSilenceUs - (fillerMarkCount * MIN_TIMING_US);
    if (remainingSpaceUs < spaceCount * MIN_TIMING_US) return null;

    const result = [];
    for (let index = 0; index < spaceCount; index += 1) {
      const remainingBuckets = spaceCount - index - 1;
      const maxForThisBucket = remainingSpaceUs - (remainingBuckets * MIN_TIMING_US);
      const spaceUs = Math.min(MAX_TIMING_US, maxForThisBucket);
      if (spaceUs < MIN_TIMING_US) return null;

      result.push(index === 0 ? terminalMark : MIN_TIMING_US, spaceUs);
      remainingSpaceUs -= spaceUs;
    }

    return remainingSpaceUs === 0 ? result : null;
  }

}

IrSequenceCompiler.MAX_COMPILED_PAIRS = MAX_COMPILED_PAIRS;

module.exports = IrSequenceCompiler;
