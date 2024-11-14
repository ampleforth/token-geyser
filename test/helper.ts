import { ethers } from "hardhat";
import { promisify } from "util";
import { expect } from "chai";

const AMPL_DECIMALS = 9;

function $AMPL(x: number) {
  return ethers.parseUnits(x.toFixed(AMPL_DECIMALS), AMPL_DECIMALS);
}

// Perc has to be a whole number
async function invokeRebase(ampl, perc) {
  await ampl.rebase(1, ((await ampl.totalSupply()) * BigInt(perc)) / 100n);
}

function checkAmplAprox(x, y) {
  checkAprox(x, $AMPL(y), BigInt(10 ** 7));
}

function checkSharesAprox(x, y) {
  checkAprox(x, y, BigInt(10 ** 12));
}

function checkAprox(x, y, delta_) {
  const delta = BigInt(delta_);
  const upper = y + delta;
  const lower = y - delta;
  expect(x).to.gte(lower).to.lte(upper);
}

export const TimeHelpers = {
  secondsFromNow: async (secondsFromNow: number): Promise<number> => {
    return (await TimeHelpers.currentTime()) + secondsFromNow;
  },

  moveClock: async (seconds: number): Promise<void> => {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
  },

  advanceBlock: async () => {
    await hre.network.provider.send("evm_mine");
  },

  increaseTime: async (seconds: number): Promise<void> => {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  },

  setNextBlockTimestamp: async (timestamp: number): Promise<void> => {
    await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await hre.network.provider.send("evm_mine");
  },

  currentTime: async (): Promise<number> => {
    const res = await hre.network.provider.send("eth_getBlockByNumber", [
      "latest",
      false,
    ]);
    const timestamp = parseInt(res.timestamp, 16);
    return timestamp;
  },
};

async function printMethodOutput(r) {
  console.log(r.logs);
}

async function printStatus(dist) {
  console.log("Total Locked: ", await dist.totalLocked.staticCall().toString());
  console.log("Total UnLocked: ", await dist.totalUnlocked.staticCall().toString());
  const c = (await dist.unlockScheduleCount.staticCall()).toNumber();
  console.log(await dist.unlockScheduleCount.staticCall().toString());

  for (let i = 0; i < c; i++) {
    console.log(await dist.unlockSchedules.staticCall(i).toString());
  }
  // await dist.totalLocked.staticCall()
  // await dist.totalUnlocked.staticCall()
  // await dist.unlockScheduleCount.staticCall()
  // dist.updateAccounting.staticCall() // and all the logs
  // dist.unlockSchedules.staticCall(1)
}

module.exports = {
  checkAmplAprox,
  checkSharesAprox,
  invokeRebase,
  $AMPL,
  TimeHelpers,
  printMethodOutput,
  printStatus,
};
