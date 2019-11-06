const BN = require('bn.js');

const AMPL_DECIMALS = 9;
const INITIAL_AMPL_SUPPLY = toAmplDecimals(50000000);

function toAmplDecimals (x) {
  return new BN(10 ** AMPL_DECIMALS).mul(new BN(x));
}

async function invokeRebase (ampl, perc) {
  const s = await ampl.totalSupply.call();
  await ampl.rebase(1, s.mul(new BN(perc)).div(new BN(100)));
}

module.exports = { INITIAL_AMPL_SUPPLY, toAmplDecimals, invokeRebase };
