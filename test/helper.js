const { BN } = require('@openzeppelin/test-helpers');
const { promisify } = require('util');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');

const PERC_DECIMALS = 2;
const AMPL_DECIMALS = 9;

function $AMPL (x) {
  return new BN(x * (10 ** AMPL_DECIMALS));
}

// Perc has to be a whole number
async function invokeRebase (ampl, perc) {
  const s = await ampl.totalSupply.call();
  const ordinate = 10 ** PERC_DECIMALS;
  const p_ = new BN(parseInt(perc * ordinate)).div(new BN(100));
  const s_ = s.mul(p_).div(new BN(ordinate));
  await ampl.rebase(1, s_);
}

// tolerance is the fraction of 1 AMPL to be tolerated as a deviation from x
async function checkAprox (x, y, tolerance = (1.0 / 1000.0)) {
  const delta = new BN(parseInt(10 ** AMPL_DECIMALS) * tolerance);
  const upper = $AMPL(y).add(delta);
  const lower = $AMPL(y).sub(delta);
  expect(await x).to.be.bignumber.at.least(lower).and.bignumber.at.most(upper);
}

function checkExact (x, y) {
  expect(x).to.be.bignumber.be.equal($AMPL(y));
}

class TimeController {
  async initialize () {
    this.currentTime = await time.latest();
  }
  async advanceTime (seconds) {
    this.currentTime = this.currentTime.add(new BN(seconds));
    await setTimeForNextTransaction(this.currentTime);
  }
  async executeEmptyBlock () {
    await time.advanceBlock();
  }
}

async function printMethodOutput (r) {
  console.log(r.logs);
}

async function printStatus (dist) {
  console.log('Total Locked: ', await dist.totalLocked.call().toString());
  console.log('Total UnLocked: ', await dist.totalUnlocked.call().toString());
  const c = (await dist.unlockScheduleCount.call()).toNumber();
  console.log(await dist.unlockScheduleCount.call().toString());

  for (let i = 0; i < c; i++) {
    console.log(await dist.unlockSchedules.call(i).toString());
  }
  // await dist.totalLocked.call()
  // await dist.totalUnlocked.call()
  // await dist.unlockScheduleCount.call()
  // dist.updateAccounting.call() // and all the logs
  // dist.unlockSchedules.call(1)
}

async function increaseTimeForNextTransaction (diff) {
  await promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [diff.toNumber()],
    id: new Date().getTime()
  });
}

async function setTimeForNextTransaction (target) {
  if (!BN.isBN(target)) {
    target = new BN(target);
  }

  const now = (await time.latest());

  if (target.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
  const diff = target.sub(now);
  increaseTimeForNextTransaction(diff);
}

module.exports = {checkExact, checkAprox, invokeRebase, $AMPL, setTimeForNextTransaction, TimeController, printMethodOutput, printStatus};
