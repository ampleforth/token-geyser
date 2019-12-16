const BigNumber = web3.BigNumber;
require('chai').use(require('chai-bignumber')(BigNumber)).should();

const AMPL_DECIMALS = 9;
const INITIAL_AMPL_SUPPLY = toAmplDecimals(50000000);

function toAmplDecimals (x) {
  return new BigNumber(10 ** AMPL_DECIMALS).times(new BigNumber(parseInt(x * 100))).dividedBy(new BigNumber(100));
}

function toAmplDecimalsStr (x) {
  return toAmplDecimals(x).toString();
}

async function invokeRebase (ampl, perc) {
  const s = await ampl.totalSupply.call();
  await ampl.rebase(1, s.times(new BigNumber(perc)).dividedBy(new BigNumber(100)));
}

async function checkAproxBal (x, y) {
  const delta = new BigNumber(toAmplDecimalsStr(1)).dividedBy(new BigNumber(5));
  (await x).should.be.bignumber.gt(toAmplDecimals(y).minus(delta));
  (await x).should.be.bignumber.lt(toAmplDecimals(y).plus(delta));
}

module.exports = { INITIAL_AMPL_SUPPLY, checkAproxBal, toAmplDecimalsStr, invokeRebase };
