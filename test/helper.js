const { BN } = require('@openzeppelin/test-helpers');
const { promisify } = require('util');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');

const PERC_DECIMALS = 2;
const AMPL_DECIMALS = 9;

function $AMPL (x) {
  const ordinate = new BN(10 ** AMPL_DECIMALS);
  return new BN(parseInt(x)).mul(ordinate);
}

async function invokeRebase (ampl, perc) {
  const s = await ampl.totalSupply.call();
  const ordinate = 10 ** PERC_DECIMALS;
  const p_ = new BN(parseInt(perc * ordinate)).div(new BN(100));
  const s_ = s.mul(p_).div(new BN(ordinate));
  await ampl.rebase(1, s_);
}

async function checkAprox (x, y, tolerance = 0.2) {
  const ordinate = 10 ** PERC_DECIMALS;
  const t_ = new BN(parseInt(tolerance * ordinate));
  const delta = new BN($AMPL(1)).mul(t_).div(new BN(ordinate));
  const upper = $AMPL(y).add(delta);
  const lower = $AMPL(y).sub(delta);
  expect(await x).to.be.bignumber.at.least(lower).and.bignumber.at.most(upper);
}

async function setTimeForNextTransaction (target) {
  if (!BN.isBN(target)) {
    target = new BN(target);
  }

  const now = (await time.latest());

  if (target.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
  const diff = target.sub(now);
  await promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [diff.toNumber()],
    id: new Date().getTime()
  });
}

module.exports = {checkAprox, invokeRebase, $AMPL, setTimeForNextTransaction};
