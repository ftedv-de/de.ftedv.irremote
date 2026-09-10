'use strict';

const PRONTO_TIMEBASE_US = 0.241246;

class IrCodeConverter {

  static prontoHexToRaw(prontoHex) {
    if (typeof prontoHex !== 'string' || !prontoHex.trim()) {
      throw new Error('ProntoHex code must be a non-empty string');
    }

    const words = prontoHex.trim().split(/\s+/);
    if (words.length < 6 || words.some((word) => !/^[0-9a-fA-F]{4}$/.test(word))) {
      throw new Error('ProntoHex code must contain 4-digit hexadecimal words');
    }

    const values = words.map((word) => Number.parseInt(word, 16));
    const type = values[0];
    if (type !== 0x0000) {
      throw new Error(`Unsupported ProntoHex type 0x${type.toString(16).toUpperCase().padStart(4, '0')}; only learned/raw type 0000 is supported`);
    }

    const frequencyWord = values[1];
    if (frequencyWord === 0) {
      throw new Error('ProntoHex carrier frequency word must not be zero');
    }

    const introPairs = values[2];
    const repeatPairs = values[3];
    const expectedWords = 4 + ((introPairs + repeatPairs) * 2);
    if (values.length !== expectedWords) {
      throw new Error(`ProntoHex length mismatch: expected ${expectedWords} words, got ${values.length}`);
    }

    const periodUs = frequencyWord * PRONTO_TIMEBASE_US;
    const carrier = Math.round(1000000 / periodUs);
    const durations = values.slice(4).map((value) => Math.max(1, Math.round(value * periodUs)));
    const introLength = introPairs * 2;

    return {
      format: 'raw',
      carrier,
      code: durations,
      intro: durations.slice(0, introLength),
      repeat: durations.slice(introLength),
      introPairs,
      repeatPairs,
    };
  }

  static codeToRaw(value) {
    if (!value || typeof value !== 'object') {
      throw new Error('IR code must be an object');
    }

    if (value.format === 'raw') {
      return {
        format: 'raw',
        carrier: value.carrier === undefined ? 38000 : Number(value.carrier),
        code: [...value.code],
        intro: [...value.code],
        repeat: [],
        introPairs: value.code.length / 2,
        repeatPairs: 0,
      };
    }

    if (value.format === 'pronto') {
      return IrCodeConverter.prontoHexToRaw(value.code);
    }

    throw new Error(`Unsupported IR code format: ${value.format}`);
  }

}

module.exports = IrCodeConverter;
