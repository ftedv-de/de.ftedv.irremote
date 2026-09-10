'use strict';

class IrSignalEncoder {

  constructor({ carrier, words, timingTolerance = 0.25, carrierToleranceHz = 1500 }) {
    if (!Number.isInteger(carrier) || carrier <= 0) {
      throw new Error('IR signal carrier must be a positive integer');
    }
    if (!Array.isArray(words) || words.length < 2) {
      throw new Error('IR signal words must contain at least two timing pairs');
    }

    this.carrier = carrier;
    this.words = words.map((word, index) => {
      if (!Array.isArray(word) || word.length !== 2
        || word.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error(`IR signal word ${index} must contain two positive integer timings`);
      }
      return [...word];
    });
    this.timingTolerance = timingTolerance;
    this.carrierToleranceHz = carrierToleranceHz;
  }

  encode(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Raw IR code is required');
    if (!Number.isInteger(raw.carrier)) throw new Error('Raw IR carrier must be an integer');
    if (Math.abs(raw.carrier - this.carrier) > this.carrierToleranceHz) {
      throw new Error(
        `IR carrier ${raw.carrier} Hz cannot be sent by the current ${this.carrier} Hz signal`,
      );
    }

    return this.timingsToFrame(raw.intro);
  }

  timingsToFrame(timings) {
    if (!Array.isArray(timings) || timings.length === 0 || timings.length % 2 !== 0) {
      throw new Error('Raw IR timings must contain complete mark/space pairs');
    }

    const frame = [];
    for (let offset = 0; offset < timings.length; offset += 2) {
      const pair = [Math.abs(timings[offset]), Math.abs(timings[offset + 1])];
      if (pair.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error(`Invalid IR timing pair at pair ${offset / 2}`);
      }

      const match = this.findClosestWord(pair);
      if (!match) {
        throw new Error(
          `Unsupported IR timing pair ${pair[0]}/${pair[1]} us at pair ${offset / 2}`,
        );
      }
      frame.push(match.index);
    }
    return frame;
  }

  findClosestWord(pair) {
    let best = null;

    this.words.forEach((word, index) => {
      const markError = Math.abs(pair[0] - word[0]) / word[0];
      const spaceError = Math.abs(pair[1] - word[1]) / word[1];
      if (markError > this.timingTolerance || spaceError > this.timingTolerance) return;

      const score = markError + spaceError;
      if (!best || score < best.score) best = { index, score };
    });

    return best;
  }

}

module.exports = IrSignalEncoder;
