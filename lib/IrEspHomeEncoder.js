'use strict';

const IrCodeConverter = require('./IrCodeConverter');
const IrSequence = require('./IrSequence');

class IrEspHomeEncoder {

  static encode(code, repetitions = 1) {
    const repeatCount = Number(repetitions);
    if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 20) {
      throw new Error('Repetitions must be between 1 and 20');
    }

    const normalized = IrSequence.normalize(code);
    const frames = IrSequence.isSequence(normalized)
      ? normalized.frames
      : [{ code: normalized, delayAfterMs: 0 }];

    const decoded = frames.map((frame) => ({
      raw: IrCodeConverter.codeToRaw(frame.code),
      delayAfterMs: frame.delayAfterMs || 0,
    }));
    const carrier = decoded[0].raw.carrier;

    if (decoded.some((frame) => frame.raw.carrier !== carrier)) {
      throw new Error('ESPHome output requires all frames in a sequence to use the same carrier');
    }

    const durations = [];
    decoded.forEach((frame, index) => {
      durations.push(...frame.raw.code.map((timing) => Math.abs(timing)));
      if (index < decoded.length - 1 && frame.delayAfterMs > 0) {
        durations[durations.length - 1] += Math.round(frame.delayAfterMs * 1000);
      }
    });

    return {
      version: 1,
      carrier,
      repetitions: repeatCount,
      timings: durations.map((timing, index) => (index % 2 === 0 ? timing : -timing)),
    };
  }

}

module.exports = IrEspHomeEncoder;
