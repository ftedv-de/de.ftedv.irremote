'use strict';

const {
  MAX_TIMING_US,
  encodePair,
  selectCarrier,
} = require('./IrCodebook');

class IrCodebookEncoder {

  encode(raw, repetitions = 1) {
    if (!raw || typeof raw !== 'object') throw new Error('Raw IR code is required');
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
      throw new Error('IR repetitions must be between 1 and 20');
    }

    const hasIntro = Array.isArray(raw.intro) && raw.intro.length > 0;
    const hasRepeat = Array.isArray(raw.repeat) && raw.repeat.length > 0;
    if (!hasIntro && !hasRepeat) throw new Error('Raw IR code has no timings to send');

    const carrier = selectCarrier(raw.carrier);
    const intro = hasIntro ? this.encodeTimings(raw.intro, 'intro') : null;
    const repeat = hasRepeat ? this.encodeTimings(raw.repeat, 'repeat') : null;

    const first = intro || repeat;
    let frame = [...first.frame];
    let txRepetitions = repetitions;

    if (intro && repeat && repetitions > 1) {
      for (let count = 1; count < repetitions; count += 1) {
        frame.push(...repeat.frame);
      }
      txRepetitions = 1;
    }

    return {
      ...carrier,
      frame,
      txRepetitions,
      quantization: {
        maxTimingError: Math.max(intro ? intro.maxTimingError : 0, repeat ? repeat.maxTimingError : 0),
        terminalSpaceClamped: Boolean(intro?.terminalSpaceClamped || repeat?.terminalSpaceClamped),
      },
    };
  }

  encodeTimings(timings, section) {
    if (!Array.isArray(timings) || timings.length === 0 || timings.length % 2 !== 0) {
      throw new Error(`Raw IR ${section} timings must contain complete mark/space pairs`);
    }

    const frame = [];
    let maxTimingError = 0;
    let terminalSpaceClamped = false;

    for (let offset = 0; offset < timings.length; offset += 2) {
      const pairNumber = offset / 2;
      const mark = Math.abs(timings[offset]);
      let space = Math.abs(timings[offset + 1]);
      if (!Number.isInteger(mark) || !Number.isInteger(space) || mark <= 0 || space <= 0) {
        throw new Error(`Invalid IR timing pair at ${section} pair ${pairNumber}`);
      }
      if (mark > MAX_TIMING_US) {
        throw new Error(`IR mark ${mark} us exceeds Homey's ${MAX_TIMING_US} us limit`);
      }
      if (space > MAX_TIMING_US) {
        if (offset + 2 !== timings.length) {
          throw new Error(`IR space ${space} us exceeds Homey's ${MAX_TIMING_US} us limit inside the frame`);
        }
        space = MAX_TIMING_US;
        terminalSpaceClamped = true;
      }

      const encoded = encodePair(mark, space);
      frame.push(encoded.index);
      maxTimingError = Math.max(maxTimingError, encoded.markError, encoded.spaceError);
    }

    return { frame, maxTimingError, terminalSpaceClamped };
  }

}

module.exports = IrCodebookEncoder;
