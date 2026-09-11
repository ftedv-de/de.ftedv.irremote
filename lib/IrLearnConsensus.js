'use strict';

const IrCodeConverter = require('./IrCodeConverter');

const DEFAULT_REQUIRED_MATCHES = 3;
const DEFAULT_MAX_CAPTURES = 5;
const DEFAULT_TIMING_TOLERANCE = 0.30;
const DEFAULT_CARRIER_TOLERANCE_HZ = 1500;
const DEFAULT_FALLBACK_MIN_CAPTURES = 4;
const DEFAULT_FALLBACK_MAX_DIFFERING_BITS = 3;

class IrLearnConsensus {

  constructor({
    requiredMatches = DEFAULT_REQUIRED_MATCHES,
    maxCaptures = DEFAULT_MAX_CAPTURES,
    timingTolerance = DEFAULT_TIMING_TOLERANCE,
    carrierToleranceHz = DEFAULT_CARRIER_TOLERANCE_HZ,
    fallbackMinCaptures = DEFAULT_FALLBACK_MIN_CAPTURES,
    fallbackMaxDifferingBits = DEFAULT_FALLBACK_MAX_DIFFERING_BITS,
  } = {}) {
    this.requiredMatches = requiredMatches;
    this.maxCaptures = maxCaptures;
    this.timingTolerance = timingTolerance;
    this.carrierToleranceHz = carrierToleranceHz;
    this.fallbackMinCaptures = fallbackMinCaptures;
    this.fallbackMaxDifferingBits = fallbackMaxDifferingBits;
  }

  createCapture(code) {
    const normalized = IrCodeConverter.normalizeCode(code);
    const raw = IrCodeConverter.codeToRaw(normalized);
    return { code: normalized, raw };
  }

  areSimilar(left, right) {
    const a = left.raw;
    const b = right.raw;

    if (!this.sameStructure(left, right)) return false;

    const compareLength = Math.max(0, a.code.length - 1);
    for (let index = 0; index < compareLength; index += 1) {
      if (IrLearnConsensus.relativeError(a.code[index], b.code[index]) > this.timingTolerance) {
        return false;
      }
    }

    return true;
  }

  sameStructure(left, right) {
    const a = left.raw;
    const b = right.raw;
    if (Math.abs(a.carrier - b.carrier) > this.carrierToleranceHz) return false;
    if (a.introPairs !== b.introPairs || a.repeatPairs !== b.repeatPairs) return false;
    return a.code.length === b.code.length;
  }

  findConsensus(captures) {
    if (!Array.isArray(captures) || captures.length < this.requiredMatches) return null;

    let bestCluster = null;
    for (const candidate of captures) {
      const cluster = captures.filter((capture) => this.areSimilar(candidate, capture));
      if (cluster.length < this.requiredMatches) continue;
      if (!bestCluster || cluster.length > bestCluster.length) bestCluster = cluster;
    }

    if (bestCluster) {
      return { ...this.selectMedoid(bestCluster), mode: 'exact' };
    }

    // Do not weaken the normal 3-of-5 rule while captures are still arriving.
    // The fallback is deliberately evaluated only after a complete learning run.
    if (captures.length < this.maxCaptures) return null;
    return this.findVariablePayloadConsensus(captures);
  }

  findVariablePayloadConsensus(captures) {
    const groups = [];
    for (const candidate of captures) {
      let group = groups.find((entries) => this.sameStructure(entries[0], candidate));
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(candidate);
    }

    let best = null;
    for (const group of groups) {
      if (group.length < this.fallbackMinCaptures) continue;
      const result = this.selectVariablePayloadMedoid(group);
      if (!result) continue;
      if (!best || result.support > best.support || (
        result.support === best.support && result.bitDistance < best.bitDistance
      )) {
        best = result;
      }
    }
    return best;
  }

  selectVariablePayloadMedoid(group) {
    let best = null;
    for (const candidate of group) {
      const distances = group
        .filter((other) => other !== candidate)
        .map((other) => this.payloadBitDistance(candidate, other))
        .filter((distance) => Number.isFinite(distance));
      const close = distances.filter(
        (distance) => distance <= this.fallbackMaxDifferingBits,
      );
      const support = close.length + 1;
      if (support < this.fallbackMinCaptures) continue;
      const bitDistance = close.reduce((sum, distance) => sum + distance, 0);
      if (!best || support > best.support || (
        support === best.support && bitDistance < best.bitDistance
      )) {
        best = {
          capture: candidate,
          clusterSize: support,
          support,
          bitDistance,
          score: bitDistance / Math.max(1, support - 1),
          mode: 'variable-payload',
        };
      }
    }
    return best;
  }

  payloadBitDistance(left, right) {
    if (!this.sameStructure(left, right)) return Number.POSITIVE_INFINITY;
    const a = left.raw.code;
    const b = right.raw.code;
    const pairCount = Math.floor(Math.max(0, a.length - 1) / 2);
    if (pairCount < 3) return Number.POSITIVE_INFINITY;

    // Infer the two payload space classes independently for each capture. Marks
    // are intentionally ignored here: the normal structural/timing checks have
    // already established that both frames use the same IR shape. The first
    // pair is treated as the leader and the final pair as trailer/idle.
    const aSpaces = [];
    const bSpaces = [];
    for (let pair = 1; pair < pairCount - 1; pair += 1) {
      aSpaces.push(Math.abs(a[(pair * 2) + 1]));
      bSpaces.push(Math.abs(b[(pair * 2) + 1]));
    }
    if (aSpaces.length === 0 || aSpaces.length !== bSpaces.length) {
      return Number.POSITIVE_INFINITY;
    }

    const aThreshold = IrLearnConsensus.twoLevelThreshold(aSpaces);
    const bThreshold = IrLearnConsensus.twoLevelThreshold(bSpaces);
    if (aThreshold === null || bThreshold === null) return Number.POSITIVE_INFINITY;

    let differingBits = 0;
    for (let index = 0; index < aSpaces.length; index += 1) {
      const aBit = aSpaces[index] > aThreshold;
      const bBit = bSpaces[index] > bThreshold;
      if (aBit !== bBit) differingBits += 1;
    }
    return differingBits;
  }

  selectMedoid(cluster) {
    let best = cluster[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of cluster) {
      const score = cluster.reduce(
        (sum, other) => sum + this.distance(candidate, other),
        0,
      );
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return {
      capture: best,
      clusterSize: cluster.length,
      score: bestScore,
    };
  }

  distance(left, right) {
    const a = left.raw;
    const b = right.raw;
    if (a.code.length !== b.code.length) return Number.POSITIVE_INFINITY;

    const compareLength = Math.max(0, a.code.length - 1);
    if (compareLength === 0) return 0;

    let total = Math.abs(a.carrier - b.carrier) / Math.max(a.carrier, b.carrier, 1);
    for (let index = 0; index < compareLength; index += 1) {
      total += IrLearnConsensus.relativeError(a.code[index], b.code[index]);
    }
    return total / (compareLength + 1);
  }

  static twoLevelThreshold(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length < 2) return null;
    let largestGap = 0;
    let threshold = null;
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = sorted[index] - sorted[index - 1];
      if (gap > largestGap) {
        largestGap = gap;
        threshold = (sorted[index] + sorted[index - 1]) / 2;
      }
    }
    // Require clearly separated short/long spaces; otherwise this is not a
    // binary pulse-distance frame and the conservative fallback must not apply.
    if (threshold === null || largestGap < Math.max(100, sorted[0] * 0.5)) return null;
    return threshold;
  }

  static relativeError(a, b) {
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
  }

}

IrLearnConsensus.DEFAULT_REQUIRED_MATCHES = DEFAULT_REQUIRED_MATCHES;
IrLearnConsensus.DEFAULT_MAX_CAPTURES = DEFAULT_MAX_CAPTURES;

module.exports = IrLearnConsensus;
