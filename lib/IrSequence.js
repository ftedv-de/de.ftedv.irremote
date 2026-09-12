'use strict';

const IrCodeConverter = require('./IrCodeConverter');

const MAX_SEQUENCE_FRAMES = 32;
const MAX_DELAY_MS = 5000;

class IrSequence {

  static isSequence(value) {
    return Boolean(value && value.format === 'sequence');
  }

  static normalize(value) {
    if (!value) return null;
    if (!IrSequence.isSequence(value)) return IrCodeConverter.normalizeCode(value);
    if (!Array.isArray(value.frames) || value.frames.length === 0) {
      throw new Error('IR sequence must contain at least one frame');
    }
    if (value.frames.length > MAX_SEQUENCE_FRAMES) {
      throw new Error(`IR sequence may contain at most ${MAX_SEQUENCE_FRAMES} frames`);
    }

    return {
      format: 'sequence',
      frames: value.frames.map((frame) => {
        if (!frame || typeof frame !== 'object' || !frame.code) {
          throw new Error('Every IR sequence frame needs a code');
        }
        const delayAfterMs = Number(frame.delayAfterMs || 0);
        if (!Number.isFinite(delayAfterMs) || delayAfterMs < 0 || delayAfterMs > MAX_DELAY_MS) {
          throw new Error(`IR sequence delays must be between 0 and ${MAX_DELAY_MS} ms`);
        }
        return {
          code: IrCodeConverter.normalizeCode(frame.code),
          delayAfterMs: Math.round(delayAfterMs),
        };
      }),
    };
  }

  static clone(value) {
    const normalized = IrSequence.normalize(value);
    if (!normalized) return null;
    if (!IrSequence.isSequence(normalized)) {
      return {
        ...normalized,
        code: Array.isArray(normalized.code) ? [...normalized.code] : normalized.code,
      };
    }
    return {
      format: 'sequence',
      frames: normalized.frames.map((frame) => ({
        delayAfterMs: frame.delayAfterMs,
        code: {
          ...frame.code,
          code: Array.isArray(frame.code.code) ? [...frame.code.code] : frame.code.code,
        },
      })),
    };
  }

}

IrSequence.MAX_SEQUENCE_FRAMES = MAX_SEQUENCE_FRAMES;
IrSequence.MAX_DELAY_MS = MAX_DELAY_MS;

module.exports = IrSequence;
