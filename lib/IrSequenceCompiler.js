'use strict';

const IrCodeConverter = require('./IrCodeConverter');
const { MAX_SPACE_TIMING_US, selectCarrier } = require('./IrCodebook');

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
    const signalId = selected[0].signalId;

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
      if (index < decoded.length - 1) {
        const delayUs = Math.round(frame.delayAfterMs * 1000);
        const terminalSpaceIndex = frameTimings.length - 1;
        frameTimings[terminalSpaceIndex] += delayUs;
        if (frameTimings[terminalSpaceIndex] > MAX_SPACE_TIMING_US) return null;
      }
      timings.push(...frameTimings);
    }

    return {
      format: 'raw',
      carrier: decoded[0].raw.carrier,
      code: timings,
    };
  }

}

module.exports = IrSequenceCompiler;
