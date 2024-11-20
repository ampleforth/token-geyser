import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  TimeHelpers,
  $AMPL,
  invokeRebase,
  checkAmplAprox,
  checkSharesAprox,
  deployGeyser,
} from "../test/helper";
import { SignerWithAddress } from "ethers";

let ampl: any,
  tokenPoolImpl: any,
  dist: any,
  owner: SignerWithAddress,
  anotherAccount: SignerWithAddress;
const InitialSharesPerToken = BigInt(10 ** 6);
const ONE_YEAR = 365 * 24 * 3600;
const START_BONUS = 50;
const BONUS_PERIOD = 86400;

async function setupContracts() {
  [owner, anotherAccount] = await ethers.getSigners();

  const AmpleforthErc20 = await ethers.getContractFactory("UFragments");
  ampl = await AmpleforthErc20.deploy();
  await ampl.initialize(await owner.getAddress());
  await ampl.setMonetaryPolicy(await owner.getAddress());

  const TokenPool = await ethers.getContractFactory("TokenPool");
  const tokenPoolImpl = await TokenPool.deploy();

  dist = await deployGeyser(owner, [
    tokenPoolImpl.target,
    ampl.target,
    ampl.target,
    10,
    START_BONUS,
    BONUS_PERIOD,
    InitialSharesPerToken,
  ]);

  return { ampl, tokenPoolImpl, dist, owner, anotherAccount };
}

async function checkAvailableToUnlock(dist, v) {
  const u = await dist.totalUnlocked.staticCall();
  const r = await dist.updateAccounting.staticCall();
  // console.log('Total unlocked: ', u.toString(), 'total unlocked after: ', r[1].toString());
  checkAmplAprox(r[1] - u, v);
}

describe("LockedPool", function () {
  beforeEach("setup contracts", async function () {
    ({ ampl, tokenPoolImpl, dist, owner, anotherAccount } = await loadFixture(
      setupContracts,
    ));
  });

  describe("distributionToken", function () {
    it("should return the staking token", async function () {
      expect(await dist.distributionToken.staticCall()).to.equal(ampl.target);
    });
  });

  describe("lockTokens", function () {
    describe("when not approved", function () {
      it("should fail", async function () {
        const d = await deployGeyser(owner, [
          tokenPoolImpl.target,
          ampl.target,
          ampl.target,
          5n,
          START_BONUS,
          BONUS_PERIOD,
          InitialSharesPerToken,
        ]);
        await expect(d.lockTokens($AMPL(10), ONE_YEAR)).to.be.reverted;
      });
    });

    describe("when number of unlock schedules exceeds the maxUnlockSchedules", function () {
      it("should fail", async function () {
        const d = await deployGeyser(owner, [
          tokenPoolImpl.target,
          ampl.target,
          ampl.target,
          5n,
          START_BONUS,
          BONUS_PERIOD,
          InitialSharesPerToken,
        ]);
        await ampl.approve(d.target, $AMPL(100));
        for (let i = 0; i < 5; i++) {
          await d.lockTokens($AMPL(10), ONE_YEAR);
        }
        await expect(d.lockTokens($AMPL(10), ONE_YEAR)).to.be.revertedWith(
          "TokenGeyser: reached maximum unlock schedules",
        );
      });
    });

    describe("when totalLocked=0", function () {
      beforeEach(async function () {
        checkAmplAprox(await dist.totalLocked(), 0);
        await ampl.approve(dist.target, $AMPL(100));
      });
      it("should updated the locked pool balance", async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked(), 100);
      });
      it("should create a schedule", async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        const s = await dist.unlockSchedules(0);
        expect(s.initialLockedShares).to.equal(
          $AMPL(100) * BigInt(InitialSharesPerToken),
        );
        expect(s.unlockedShares).to.equal($AMPL(0));
        expect(s.lastUnlockTimestampSec + s.durationSec).to.equal(s.endAtSec);
        expect(s.durationSec).to.equal(ONE_YEAR);
        expect(await dist.unlockScheduleCount()).to.equal(1);
      });
      it("should log TokensLocked", async function () {
        const r = await dist.lockTokens($AMPL(100), ONE_YEAR);
        await expect(r)
          .to.emit(dist, "TokensLocked")
          .withArgs($AMPL(100), ONE_YEAR, $AMPL(100));
      });
      it("should be protected", async function () {
        await ampl.approve(dist.target, $AMPL(100));
        await expect(
          dist.connect(anotherAccount).lockTokens($AMPL(50), ONE_YEAR),
        ).to.be.revertedWithCustomError(dist, "OwnableUnauthorizedAccount");
        await dist.lockTokens($AMPL(50), ONE_YEAR);
      });
    });

    describe("when totalLocked>0", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(150));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked(), 100);
        await TimeHelpers.increaseTime(ONE_YEAR / 10);
      });
      it("should update the locked and unlocked pool balance", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked(), 100 * 0.9 + 50);
      });
      it("should log TokensUnlocked and TokensLocked", async function () {
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        const txR = await r.wait();
        let l = txR.logs.find(l => l.fragment?.name === "TokensUnlocked");
        checkAmplAprox(l.args.amount, 100 * 0.1);
        checkAmplAprox(l.args.total, 100 * 0.9);

        l = txR.logs.find(l => l.fragment?.name === "TokensLocked");
        checkAmplAprox(l.args.amount, 50);
        checkAmplAprox(l.args.total, 100 * 0.9 + 50);
        expect(l.args.durationSec).to.eq(ONE_YEAR);
      });
      it("should create a schedule", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules(1);
        // struct UnlockSchedule {
        // 0   uint256 initialLockedShares;
        // 1   uint256 unlockedShares;
        // 2   uint256 lastUnlockTimestampSec;
        // 3   uint256 endAtSec;
        // 4   uint256 durationSec;
        // }
        checkSharesAprox(s[0], $AMPL(50) * BigInt(InitialSharesPerToken));
        checkSharesAprox(s[1], 0n);
        expect(s[2] + s[4]).to.equal(s[3]);
        expect(s[4]).to.equal(ONE_YEAR);
        expect(await dist.unlockScheduleCount()).to.equal(2);
      });
    });

    describe("when totalLocked>0", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(150));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 100);
        await TimeHelpers.increaseTime(ONE_YEAR / 10);
      });
      it("should updated the locked and unlocked pool balance", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 100 * 0.9 + 50);
      });
      it("should log TokensUnlocked and TokensLocked", async function () {
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        const txR = await r.wait();
        let l = txR.logs.find(l => l.fragment?.name === "TokensUnlocked");
        checkAmplAprox(l.args.amount, 100 * 0.1);
        checkAmplAprox(l.args.total, 100 * 0.9);

        l = txR.logs.find(l => l.fragment?.name === "TokensLocked");
        checkAmplAprox(l.args.amount, 50);
        checkAmplAprox(l.args.total, 100 * 0.9 + 50);
        expect(l.args.durationSec).to.eq(ONE_YEAR);
      });
      it("should create a schedule", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.staticCall(1);
        checkSharesAprox(s[0], $AMPL(50) * BigInt(InitialSharesPerToken));
        checkSharesAprox(s[1], 0n);
        expect(s[2] + s[4]).to.equal(s[3]);
        expect(s[4]).to.equal(ONE_YEAR);
        expect(await dist.unlockScheduleCount()).to.equal(2);
      });
    });

    describe("when totalLocked>0, rebase increases supply", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(150));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 100);
        await TimeHelpers.increaseTime(ONE_YEAR / 10);
        await invokeRebase(ampl, 100);
      });
      it("should update the locked pool balance", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 50 + 200 * 0.9);
      });
      it("should log TokensUnlocked and TokensLocked", async function () {
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        const txR = await r.wait();
        let l = txR.logs.find(l => l.fragment?.name === "TokensUnlocked");
        checkAmplAprox(l.args.amount, 200 * 0.1);
        checkAmplAprox(l.args.total, 200 * 0.9);

        l = txR.logs.find(l => l.fragment?.name === "TokensLocked");
        checkAmplAprox(l.args.amount, 50);
        checkAmplAprox(l.args.total, 50 + 200 * 0.9);
        expect(l.args.durationSec).to.eq(ONE_YEAR);
      });
      it("should create a schedule", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.staticCall(1);
        checkSharesAprox(s[0], $AMPL(25) * BigInt(InitialSharesPerToken));
        checkSharesAprox(s[1], 0n);
        expect(s[2] + s[4]).to.equal(s[3]);
        expect(s[4]).to.equal(ONE_YEAR);
        expect(await dist.unlockScheduleCount()).to.equal(2);
      });
    });

    describe("when totalLocked>0, rebase decreases supply", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(150));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 100);
        await TimeHelpers.increaseTime(ONE_YEAR / 10);
        await invokeRebase(ampl, -50);
      });
      it("should updated the locked pool balance", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAmplAprox(await dist.totalLocked.staticCall(), 0.9 * 50 + 50);
      });
      it("should log TokensUnlocked and TokensLocked", async function () {
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        const txR = await r.wait();

        let l = txR.logs.find(l => l.fragment?.name === "TokensUnlocked");
        checkAmplAprox(l.args.amount, 50 * 0.1);
        checkAmplAprox(l.args.total, 50 * 0.9);

        l = txR.logs.find(l => l.fragment?.name === "TokensLocked");
        checkAmplAprox(l.args.amount, 50);
        checkAmplAprox(l.args.total, 50 + 50 * 0.9);
        expect(l.args.durationSec).to.eq(ONE_YEAR);
      });
      it("should create a schedule", async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.staticCall(1);
        checkSharesAprox(s[0], $AMPL(100) * BigInt(InitialSharesPerToken));
        checkSharesAprox(s[1], 0n);
        expect(s[2] + s[4]).to.equal(s[3]);
        expect(s[4]).to.equal(ONE_YEAR);
        expect(await dist.unlockScheduleCount()).to.equal(2);
      });
    });
  });

  describe("unlockTokens", function () {
    describe("single schedule", function () {
      describe("after waiting for 1/2 the duration", function () {
        beforeEach(async function () {
          await ampl.approve(dist.target, $AMPL(100));
          await dist.lockTokens($AMPL(100), ONE_YEAR);
          await TimeHelpers.increaseTime(ONE_YEAR / 2);
        });

        describe("when supply is unchanged", function () {
          it("should unlock 1/2 the tokens", async function () {
            expect(await dist.totalLocked()).to.eq($AMPL(100));
            expect(await dist.totalUnlocked()).to.eq($AMPL(0));
            await checkAvailableToUnlock(dist, 50);
          });
          it("should transfer tokens to unlocked pool", async function () {
            await dist.updateAccounting();
            checkAmplAprox(await dist.totalLocked(), 50);
            checkAmplAprox(await dist.totalUnlocked(), 50);
            await checkAvailableToUnlock(dist, 0);
          });
          it("should log TokensUnlocked and update state", async function () {
            const r = await dist.updateAccounting();
            const receipt = await r.wait();
            const event = receipt.events?.find(event => event.event === "TokensUnlocked");
            if (event && event.args) {
              checkAmplAprox(event.args.amount, 50);
              checkAmplAprox(event.args.total, 50);
            }
            const s = await dist.unlockSchedules(0);
            expect(s[0]).to.eq($AMPL(100) * InitialSharesPerToken);
            checkSharesAprox(s[1], $AMPL(50) * InitialSharesPerToken);
          });
        });

        describe("when rebase increases supply", function () {
          beforeEach(async function () {
            await invokeRebase(ampl, 100);
          });
          it("should unlock 1/2 the tokens", async function () {
            expect(await dist.totalLocked()).to.eq($AMPL(200));
            expect(await dist.totalUnlocked()).to.eq($AMPL(0));
            await checkAvailableToUnlock(dist, 100);
          });
          it("should transfer tokens to unlocked pool", async function () {
            await dist.updateAccounting();
            checkAmplAprox(await dist.totalLocked(), 100);
            checkAmplAprox(await dist.totalUnlocked(), 100);
            await checkAvailableToUnlock(dist, 0);
          });
        });

        describe("when rebase decreases supply", function () {
          beforeEach(async function () {
            await invokeRebase(ampl, -50);
          });
          it("should unlock 1/2 the tokens", async function () {
            expect(await dist.totalLocked()).to.eq($AMPL(50));
            await checkAvailableToUnlock(dist, 25);
          });
          it("should transfer tokens to unlocked pool", async function () {
            expect(await dist.totalLocked()).to.eq($AMPL(50));
            expect(await dist.totalUnlocked()).to.eq($AMPL(0));
            await dist.updateAccounting();
            checkAmplAprox(await dist.totalLocked(), 25);
            checkAmplAprox(await dist.totalUnlocked(), 25);
            await checkAvailableToUnlock(dist, 0);
          });
        });
      });

      describe("after waiting > the duration", function () {
        beforeEach(async function () {
          await ampl.approve(dist.target, $AMPL(100));
          await dist.lockTokens($AMPL(100), ONE_YEAR);
          await TimeHelpers.increaseTime(2 * ONE_YEAR);
        });
        it("should unlock all the tokens", async function () {
          await checkAvailableToUnlock(dist, 100);
        });
        it("should transfer tokens to unlocked pool", async function () {
          expect(await dist.totalLocked()).to.eq($AMPL(100));
          expect(await dist.totalUnlocked()).to.eq($AMPL(0));
          await dist.updateAccounting();
          expect(await dist.totalLocked()).to.eq($AMPL(0));
          checkAmplAprox(await dist.totalUnlocked(), 100);
          await checkAvailableToUnlock(dist, 0);
        });
        it("should log TokensUnlocked and update state", async function () {
          const r = await dist.updateAccounting();
          const receipt = await r.wait();
          const event = receipt.events?.find(event => event.event === "TokensUnlocked");
          if (event && event.args) {
            checkAmplAprox(event.args.amount, 50);
            checkAmplAprox(event.args.total, 50);
          }
          const s = await dist.unlockSchedules(0);
          expect(s[0]).to.eq($AMPL(100) * InitialSharesPerToken);
          checkSharesAprox(s[1], $AMPL(100) * InitialSharesPerToken);
        });
      });

      describe("dust tokens due to division underflow", function () {
        beforeEach(async function () {
          await ampl.approve(dist.target, $AMPL(100));
          await dist.lockTokens($AMPL(1), 10 * ONE_YEAR);
        });
        it("should unlock all tokens", async function () {
          await TimeHelpers.increaseTime(10 * ONE_YEAR - 60);
          const r1 = await dist.updateAccounting();
          const receipt1 = await r1.wait();
          const l1 = receipt1.events?.find(event => event.event === "TokensUnlocked");
          await TimeHelpers.increaseTime(65);
          const r2 = await dist.updateAccounting();
          const receipt2 = await r2.wait();
          const l2 = receipt2.events?.find(event => event.event === "TokensUnlocked");
          if (l1 && l2 && l1.args && l2.args) {
            expect(l1.args.amount.add(l2.args.amount)).to.eq($AMPL(1));
          }
        });
      });
    });

    describe("multi schedule", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(200));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        await TimeHelpers.increaseTime(ONE_YEAR / 2);
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        await TimeHelpers.increaseTime(ONE_YEAR / 10);
      });

      it("should return the remaining unlock value", async function () {
        checkAmplAprox(await dist.totalLocked(), 150);
        checkAmplAprox(await dist.totalUnlocked(), 50);
        await checkAvailableToUnlock(dist, 20);
      });

      it("should transfer tokens to unlocked pool", async function () {
        await dist.updateAccounting();
        checkAmplAprox(await dist.totalLocked(), 130);
        checkAmplAprox(await dist.totalUnlocked(), 70);
        await checkAvailableToUnlock(dist, 0);
      });

      it("should log TokensUnlocked and update state", async function () {
        const r = await dist.updateAccounting();
        const receipt = await r.wait();
        const l = receipt.events?.find(event => event.event === "TokensUnlocked");
        if (l?.args) {
          checkAmplAprox(l.args.amount, 20);
          checkAmplAprox(l.args.total, 130);
        }

        const s1 = await dist.unlockSchedules(0);
        checkSharesAprox(s1[0], $AMPL(100) * InitialSharesPerToken);
        checkSharesAprox(s1[1], $AMPL(60) * InitialSharesPerToken);
        const s2 = await dist.unlockSchedules(1);
        checkSharesAprox(s2[0], $AMPL(100) * InitialSharesPerToken);
        checkSharesAprox(s2[1], $AMPL(10) * InitialSharesPerToken);
      });

      it("should continue linear the unlock", async function () {
        await dist.updateAccounting();
        await TimeHelpers.increaseTime(ONE_YEAR / 5);
        await dist.updateAccounting();

        checkAmplAprox(await dist.totalLocked(), 90);
        checkAmplAprox(await dist.totalUnlocked(), 110);
        await checkAvailableToUnlock(dist, 0);

        await TimeHelpers.increaseTime(ONE_YEAR / 5);
        await dist.updateAccounting();

        checkAmplAprox(await dist.totalLocked(), 50);
        checkAmplAprox(await dist.totalUnlocked(), 150);
        await checkAvailableToUnlock(dist, 0);
      });
    });
  });

  describe("updateAccounting", function () {
    let _r, _t;
    beforeEach(async function () {
      _r = await dist.updateAccounting.staticCall({ from: owner });
      _t = await TimeHelpers.currentTime();
      await ampl.approve(dist.target, $AMPL(300));
      await dist.stake($AMPL(100));
      await dist.lockTokens($AMPL(100), ONE_YEAR);
      await TimeHelpers.increaseTime(ONE_YEAR / 2);
      await dist.lockTokens($AMPL(100), ONE_YEAR);
      await TimeHelpers.increaseTime(ONE_YEAR / 10);
    });

    describe("when user history does exist", async function () {
      it("should return the system state", async function () {
        const r = await dist.updateAccounting.staticCall();
        const t = await TimeHelpers.currentTime();
        checkAmplAprox(r[0], 130);
        checkAmplAprox(r[1], 70);
        const timeElapsed = t - _t;
        expect(r[2] / $AMPL(100) / InitialSharesPerToken)
          .to.gte(timeElapsed - 5)
          .to.lte(timeElapsed + 5);
        expect(r[3] / $AMPL(100) / InitialSharesPerToken)
          .to.gte(timeElapsed - 5)
          .to.lte(timeElapsed + 5);
        checkAmplAprox(r[4], 70);
        checkAmplAprox(r[4], 70);
        expect(r[5] - _r[5])
          .to.gte(timeElapsed - 1)
          .to.lte(timeElapsed + 1);
      });
    });

    describe("when user history does not exist", async function () {
      it("should return the system state", async function () {
        const r = dist.interface.decodeFunctionResult(
          "updateAccounting",
          await ethers.provider.call({
            from: ethers.ZeroAddress,
            to: dist.target,
            data: dist.interface.encodeFunctionData("updateAccounting"),
          }),
        );

        const t = await TimeHelpers.currentTime();
        checkAmplAprox(r[0], 130);
        checkAmplAprox(r[1], 70);
        const timeElapsed = t - _t;
        expect(r[2] / $AMPL(100) / InitialSharesPerToken).to.eq(0n);
        expect(r[3] / $AMPL(100) / InitialSharesPerToken)
          .to.gte(timeElapsed - 5)
          .to.lte(timeElapsed + 5);
        checkAmplAprox(r[4], 0);
        expect(r[5] - _r[5])
          .to.gte(timeElapsed - 1)
          .to.lte(timeElapsed + 1);
      });
    });
  });
});
