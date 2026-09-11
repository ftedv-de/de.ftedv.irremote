'use strict';

const IrCodeConverter = require('./IrCodeConverter');

const DEFAULT_REQUIRED_MATCHES = 3;
const DEFAULT_MAX_CAPTURES = 5;
const DEFAULT_TIMING_TOLERANCE = 0.30;
const DEFAULT_CARRIER_TOLERANCE_HZ = 1500;

class IrLearnConsensus {

  constructor({
    requiredMatches = DEFAULT_REQUIRED_MATCHES,
    maxCaptures = DEFAULT_MAX_CAPTURES,
    timingTolerance = DEFAULT_TIMING_TOLERANCE,
    carrierToleranceHz = DEFAULT_CARRIER_TOLERANCE_HZ,
  } = {}) {
    this.requiredMatches = requiredMatches;
    this.maxCaptures = maxCaptures;
    this.timingTolerance = timingTolerance;
    this.carrierToleranceHz = carrierToleranceHz;
  }

  createCapture(code) {
    const normalized = IrCodeConverter.normalizeCode(code);
    const raw = IrCodeConverter.codeToRaw(normalized);
    return { code: normalized, raw };
  }

  areSimilar(left, right) {
    const a = left.raw;
    const b = right.raw;

    if (Math.abs(a.carrier - b.carrier) > this.carrierToleranceHz) return false;
    if (a.introPairs !== b.introPairs || a.repeatPairs !== b.repeatPairs) return false;
    if (a.code.length !== b.code.length) return false;

    // The final idle space is often measured inconsistently by demodulating IR
    // receivers (or may be synthesized when the receiver never saw its ending
    // edge). It carries no payload after the final mark of a learned frame, so
    // exclude only that last timing from the consensus comparison.
    const compareLength = Math.max(0, a.code.length - 1);
    for (let index = 0; index < compareLength; index += 1) {
      if (IrLearnConsensus.relativeError(a.code[index], b.code[index]) > this.timingTolerance) {
        return false;
      }
    }

    return true;
  }

  findConsensus(captures) {
    if (!Array.isArray(captures) || captures.length < this.requiredMatches) return null;

    let bestCluster = null;
    for (const candidate of captures) {
      const cluster = captures.filter((capture) => this.areSimilar(candidate, capture));
      if (cluster.length < this.requiredMatches) continue;
      if (!bestCluster || cluster.length > bestCluster.length) bestCluster = cluster;
    }

    if (!bestCluster) return null;
    return this.selectMedoid(bestCluster);
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

  static relativeError(a, b) {
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);
  }

}

IrLearnConsensus.DEFAULT_REQUIRED_MATCHES = DEFAULT_REQUIRED_MATCHES;
IrLearnConsensus.DEFAULT_MAX_CAPTURES = DEFAULT_MAX_CAPTURES;

module.exports = IrLearnConsensus;
