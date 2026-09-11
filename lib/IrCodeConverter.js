'use strict';

const PRONTO_TIMEBASE_US = 0.241246;
const MIN_CARRIER_HZ = 30000;
const MAX_CARRIER_HZ = 58000;
const SYNTHETIC_TERMINAL_SPACE_US = 32767;

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

    const periodUs = frequencyWord * PRONTO_TIMEBASE_US;
    const carrier = Math.round(1000000 / periodUs);
    IrCodeConverter.assertCarrier(carrier);

    const introPairs = values[2];
    const repeatPairs = values[3];
    const expectedWords = 4 + ((introPairs + repeatPairs) * 2);
    let terminalSpaceSynthesized = false;

    if (values.length === expectedWords - 1) {
      // Demodulating IR receivers commonly stop after the final mark because the
      // following idle period has no falling edge. In a raw Pronto frame this can
      // only mean that the last (space) timing is missing. Synthesize a finite
      // terminal silence that is also the largest timing Homey's regular IR
      // signal format can represent.
      const terminalSpaceWord = Math.max(
        1,
        Math.min(0xFFFF, Math.round(SYNTHETIC_TERMINAL_SPACE_US / periodUs)),
      );
      values.push(terminalSpaceWord);
      terminalSpaceSynthesized = true;
    } else if (values.length !== expectedWords) {
      throw new Error(`ProntoHex length mismatch: expected ${expectedWords} words, got ${values.length}`);
    }

    const durations = values.slice(4).map((value, index) => {
      if (value === 0) throw new Error(`ProntoHex timing word ${index + 4} must not be zero`);
      return Math.max(1, Math.round(value * periodUs));
    });
    const introLength = introPairs * 2;
    const normalizedProntoHex = values
      .map((word) => word.toString(16).toUpperCase().padStart(4, '0'))
      .join(' ');

    return {
      format: 'raw',
      carrier,
      code: durations,
      intro: durations.slice(0, introLength),
      repeat: durations.slice(introLength),
      introPairs,
      repeatPairs,
      normalizedProntoHex,
      terminalSpaceSynthesized,
    };
  }

  static rawToProntoHex(raw, carrier = 38000) {
    IrCodeConverter.assertRawTimings(raw);
    IrCodeConverter.assertCarrier(carrier);

    const frequencyWord = Math.round(1000000 / (carrier * PRONTO_TIMEBASE_US));
    const periodUs = frequencyWord * PRONTO_TIMEBASE_US;
    const durationWords = raw.map((duration) => Math.max(
      1,
      Math.round(Math.abs(duration) / periodUs),
    ));
    const words = [0, frequencyWord, raw.length / 2, 0, ...durationWords];
    return words.map((word) => word.toString(16).toUpperCase().padStart(4, '0')).join(' ');
  }

  static codeToRaw(value) {
    if (!value || typeof value !== 'object') {
      throw new Error('IR code must be an object');
    }

    if (value.format === 'raw') {
      IrCodeConverter.assertRawTimings(value.code);
      const carrier = value.carrier === undefined ? 38000 : Number(value.carrier);
      IrCodeConverter.assertCarrier(carrier);
      return {
        format: 'raw',
        carrier,
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

  static normalizeCode(value) {
    if (!value || typeof value !== 'object') {
      throw new Error('IR code must be an object');
    }

    if (value.format === 'raw') {
      const raw = IrCodeConverter.codeToRaw(value);
      return { format: 'raw', code: [...raw.code], carrier: raw.carrier };
    }

    if (value.format === 'pronto') {
      const raw = IrCodeConverter.prontoHexToRaw(value.code);
      return {
        format: 'pronto',
        code: raw.normalizedProntoHex,
      };
    }

    throw new Error('IR code format must be raw or pronto');
  }

  static assertRawTimings(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length % 2 !== 0
      || raw.some((item) => !Number.isInteger(item) || item === 0)) {
      throw new Error('Raw IR code must contain complete non-zero integer mark/space pairs');
    }
  }

  static assertCarrier(carrier) {
    if (!Number.isInteger(carrier) || carrier < MIN_CARRIER_HZ || carrier > MAX_CARRIER_HZ) {
      throw new Error(`IR carrier must be between ${MIN_CARRIER_HZ} and ${MAX_CARRIER_HZ} Hz`);
    }
  }

}

module.exports = IrCodeConverter;
