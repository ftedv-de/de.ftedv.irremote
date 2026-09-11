'use strict';

const fs = require('fs');
const path = require('path');
const {
  CARRIER_BUCKETS,
  buildWords,
  signalIdForCarrier,
} = require('../lib/IrCodebook');

const signalDir = path.join(__dirname, '..', '.homeycompose', 'signals', 'ir');
const words = buildWords();

fs.mkdirSync(signalDir, { recursive: true });

for (const carrier of CARRIER_BUCKETS) {
  const signal = {
    carrier,
    dutyCycle: 33,
    words,
    repetitions: 1,
    txOnly: true,
  };
  const file = path.join(signalDir, `${signalIdForCarrier(carrier)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(signal)}\n`);
}

console.log(`Generated ${CARRIER_BUCKETS.length} IR codebook signals with ${words.length} words each.`);
