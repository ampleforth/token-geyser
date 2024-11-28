import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  $AMPL,
  invokeRebase,
  checkAmplAprox,
  TimeHelpers,
  deployGeyser,
} from "../test/helper";
import { SignerWithAddress } from "ethers";

let ampl: any, dist: any, owner: SignerWithAddress, anotherAccount: SignerWithAddress;
const InitialSharesPerToken = 10 ** 6;
const ONE_YEAR = 1 * 365 * 24 * 3600;

async function setupContracts() {
  [owner, anotherAccount] = await ethers.getSigners();

  const AmpleforthErc20 = await ethers.getContractFactory("UFragments");
  ampl = await AmpleforthErc20.deploy();
  await ampl.initialize(await owner.getAddress());
  await ampl.setMonetaryPolicy(await owner.getAddress());

  const TokenPool = await ethers.getContractFactory("TokenPool");
  const tokenPoolImpl = await TokenPool.deploy();

  const startBonus = 50; // 50%
  const bonusPeriod = 86400; // 1 Day
  dist = await deployGeyser(owner, [
    tokenPoolImpl.target,
    ampl.target,
    ampl.target,
    10,
    startBonus,
    bonusPeriod,
    InitialSharesPerToken,
  ]);

  await ampl.transfer(await anotherAccount.getAddress(), $AMPL(50000));
  await ampl.connect(anotherAccount).approve(dist.target, $AMPL(50000));
  await ampl.connect(owner).approve(dist.target, $AMPL(50000));

  return { ampl, dist, owner, anotherAccount };
}

async function totalRewardsFor(account) {
  const r = await dist.previewRewards.staticCall(0, await account.getAddress(), 0);
  return r[4];
}

async function expectEvent(tx, name, params) {
  const txR = await tx.wait();
  const event = txR.logs?.find(event => event.fragment?.name === name);
  expect(event.args).to.deep.equal(params);
}

describe("unstaking", function () {
  beforeEach("setup contracts", async function () {
    ({ ampl, dist, owner, anotherAccount } = await loadFixture(setupContracts));
  });

  describe("unstake", function () {
    describe("when amount is 0", function () {
      it("should fail", async function () {
        await dist.connect(anotherAccount).stake($AMPL(50));
        await expect(dist.connect(anotherAccount).unstake($AMPL(0))).to.be.revertedWith(
          "TokenGeyser: unstake amount is zero",
        );
      });
    });

    describe("when rebase increases supply", function () {
      beforeEach(async function () {
        await dist.connect(anotherAccount).stake($AMPL(50));
        await TimeHelpers.increaseTime(1);
      });
      it("should fail if user tries to unstake more than his balance", async function () {
        await invokeRebase(ampl, +50);
        await expect(dist.connect(anotherAccount).unstake($AMPL(85))).to.be.revertedWith(
          "TokenGeyser: unstake amount is greater than total user stakes",
        );
      });
      it("should NOT fail if user tries to unstake his balance", async function () {
        await invokeRebase(ampl, +50);
        await dist.connect(anotherAccount).unstake($AMPL(75));
      });
      it("should fail if there are too few stakingSharesToBurn", async function () {
        await invokeRebase(ampl, 100 * InitialSharesPerToken);
        await expect(dist.connect(anotherAccount).unstake(1)).to.be.revertedWith(
          "TokenGeyser: Unable to unstake amount this small",
        );
      });
    });

    describe("when rebase decreases supply", function () {
      beforeEach(async function () {
        await dist.connect(anotherAccount).stake($AMPL(50));
        await TimeHelpers.increaseTime(1);
      });
      it("should fail if user tries to unstake more than his balance", async function () {
        await invokeRebase(ampl, -50);
        await expect(dist.connect(anotherAccount).unstake($AMPL(50))).to.be.revertedWith(
          "TokenGeyser: unstake amount is greater than total user stakes",
        );
      });
      it("should NOT fail if user tries to unstake his balance", async function () {
        await invokeRebase(ampl, -50);
        await dist.connect(anotherAccount).unstake($AMPL(25));
      });
    });

    describe("when single user stakes once", function () {
      // 100 ampls locked for 1 year, user stakes 50 ampls for 1 year
      // user is eligible for 100% of the reward,
      // unstakes 30 ampls, gets 60% of the reward (60 ampl)
      // user's final balance is 90 ampl, (20 remains staked), eligible rewards (40 ampl)
      beforeEach(async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        await dist.connect(anotherAccount).stake($AMPL(50));
        await TimeHelpers.increaseTime(ONE_YEAR);
        await dist.connect(anotherAccount).updateAccounting();
        checkAmplAprox(await totalRewardsFor(anotherAccount), 50);
      });
      it("should update the total staked and rewards", async function () {
        await dist.connect(anotherAccount).unstake($AMPL(30));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(20));
        expect(
          await dist.totalStakedBy.staticCall(await anotherAccount.getAddress()),
        ).to.eq($AMPL(20));
        checkAmplAprox(await totalRewardsFor(anotherAccount), 20);
      });
      it("should transfer back staked tokens + rewards", async function () {
        const _b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        await dist.connect(anotherAccount).unstake($AMPL(30));
        const b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        checkAmplAprox(b - _b, 90);
      });
      it("should log Unstaked", async function () {
        const r = await dist.connect(anotherAccount).unstake($AMPL(30));
        await expectEvent(r, "Unstaked", [
          await anotherAccount.getAddress(),
          $AMPL(30),
          $AMPL(20),
        ]);
      });
      it("should log TokensClaimed", async function () {
        const r = await dist.connect(anotherAccount).unstake($AMPL(30));
        await expectEvent(r, "TokensClaimed", [
          await anotherAccount.getAddress(),
          $AMPL(60),
        ]);
      });
    });

    describe("when single user unstake early with early bonus", function () {
      // Start bonus = 50%, Bonus Period = 1 Day.
      // 1000 ampls locked for 1 hour, so all will be unlocked by test-time.
      // user stakes 500 ampls for 12 hours, half the period.
      // user is eligible for 75% of the max reward,
      // unstakes 250 ampls, gets .5 * .75 * 1000 ampls
      // user's final balance is 625 ampl, (250 remains staked), eligible rewards (375 ampl)
      const ONE_HOUR = 3600;
      beforeEach(async function () {
        await dist.lockTokens($AMPL(1000), ONE_HOUR);

        await dist.connect(anotherAccount).stake($AMPL(500));
        await TimeHelpers.increaseTime(12 * ONE_HOUR);
        await dist.connect(anotherAccount).updateAccounting();
        checkAmplAprox(await totalRewardsFor(anotherAccount), 500);
      });
      it("should update the total staked and rewards", async function () {
        await dist.connect(anotherAccount).unstake($AMPL(250));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(250));
        expect(
          await dist.totalStakedBy.staticCall(await anotherAccount.getAddress()),
        ).to.eq($AMPL(250));
        checkAmplAprox(await totalRewardsFor(anotherAccount), 312.5); // (.5 * .75 * 1000) + 250
      });
      it("should transfer back staked tokens + rewards", async function () {
        const _b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        await dist.connect(anotherAccount).unstake($AMPL(250));
        const b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        checkAmplAprox(b - _b, 625);
      });
      it("should log Unstaked", async function () {
        const r = await dist.connect(anotherAccount).unstake($AMPL(250));
        await expectEvent(r, "Unstaked", [
          await anotherAccount.getAddress(),
          $AMPL(250),
          $AMPL(250),
        ]);
      });
      it("should log TokensClaimed", async function () {
        const r = await dist.connect(anotherAccount).unstake($AMPL(250));
        await expectEvent(r, "TokensClaimed", [
          await anotherAccount.getAddress(),
          $AMPL(375), // .5 * .75 * 1000
        ]);
      });
    });

    describe("when single user stakes many times", function () {
      // 100 ampls locked for 1 year,
      // user stakes 50 ampls for 1/2 year, 50 ampls for 1/4 year, [50 ampls unlocked in this time ]
      // unstakes 30 ampls, gets 20% of the unlocked reward (10 ampl) ~ [30 * 0.25 / (50*0.25+50*0.5) * 50]
      // user's final balance is 40 ampl
      beforeEach(async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);

        await TimeHelpers.increaseTime(ONE_YEAR / 100);
        await dist.connect(anotherAccount).stake($AMPL(50));

        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.connect(anotherAccount).stake($AMPL(50));
        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.connect(anotherAccount).updateAccounting();
      });
      it("checkTotalRewards", async function () {
        checkAmplAprox(await totalRewardsFor(anotherAccount), 25.5);
      });
      it("should update the total staked and rewards", async function () {
        await dist.connect(anotherAccount).unstake($AMPL(30));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(70));
        expect(
          await dist.totalStakedBy.staticCall(await anotherAccount.getAddress()),
        ).to.eq($AMPL(70));
        checkAmplAprox(await totalRewardsFor(anotherAccount), 20.4);
      });
      it("should transfer back staked tokens + rewards", async function () {
        const _b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        await dist.connect(anotherAccount).unstake($AMPL(30));
        const b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        checkAmplAprox(b - _b, 40.2);
      });
    });

    describe("when single user performs unstake many times", function () {
      // 100 ampls locked for 1 year,
      // user stakes 10 ampls, waits 1 year, stakes 10 ampls, waits 1 year,
      // unstakes 5 ampl, unstakes 5 ampl, unstakes 5 ampl
      // 3rd unstake should be worth twice the first one
      beforeEach(async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);

        await dist.connect(anotherAccount).stake($AMPL(10));
        await TimeHelpers.increaseTime(ONE_YEAR);
        await dist.connect(anotherAccount).stake($AMPL(10));
        await TimeHelpers.increaseTime(ONE_YEAR);
        await dist.connect(anotherAccount).updateAccounting();
        checkAmplAprox(await totalRewardsFor(anotherAccount), 50);
      });

      it("should use updated user accounting", async function () {
        const r1 = await dist.connect(anotherAccount).unstake($AMPL(5));
        await expectEvent(r1, "TokensClaimed", [
          await anotherAccount.getAddress(),
          16666666842n,
        ]);
        const claim1 = 16666666842n;
        const r2 = await dist.connect(anotherAccount).unstake($AMPL(5));
        await expectEvent(r2, "TokensClaimed", [
          await anotherAccount.getAddress(),
          16666667054n,
        ]);
        const r3 = await dist.connect(anotherAccount).unstake($AMPL(5));
        await expectEvent(r3, "TokensClaimed", [
          await anotherAccount.getAddress(),
          33333333052n,
        ]);
        const claim3 = 33333333052n;
        const ratio = (claim3 * 100n) / claim1;
        expect(ratio).gte(199n).lt(201);
      });
    });

    describe("when multiple users stake once", function () {
      // 100 ampls locked for 1 year,
      // userA stakes 50 ampls for 3/4 year, userb stakes 50 ampl for 1/2 year, total unlocked 75 ampl
      // userA unstakes 30 ampls, gets 36% of the unlocked reward (27 ampl) ~ [30 * 0.75 / (50*0.75+50*0.5) * 75]
      // user's final balance is 57 ampl
      beforeEach(async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);

        await TimeHelpers.increaseTime(ONE_YEAR / 100);
        await dist.connect(anotherAccount).stake($AMPL(50));

        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.stake($AMPL(50));
        await TimeHelpers.increaseTime(ONE_YEAR / 2);
        await dist.connect(anotherAccount).updateAccounting();
        await dist.updateAccounting();
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(100));
        checkAmplAprox(await totalRewardsFor(anotherAccount), 22.8);
        checkAmplAprox(await totalRewardsFor(owner), 15.2);
      });
      it("checkTotalRewards", async function () {
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(100));
        checkAmplAprox(await totalRewardsFor(anotherAccount), 22.8);
        checkAmplAprox(await totalRewardsFor(owner), 15.2);
      });
      it("should update the total staked and rewards", async function () {
        await dist.connect(anotherAccount).unstake($AMPL(30));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(70));
        expect(
          await dist.totalStakedBy.staticCall(await anotherAccount.getAddress()),
        ).to.eq($AMPL(20));
        expect(await dist.totalStakedBy.staticCall(await owner.getAddress())).to.eq(
          $AMPL(50),
        );
        checkAmplAprox(await totalRewardsFor(anotherAccount), 9.12);
        checkAmplAprox(await totalRewardsFor(owner), 15.2);
      });
      it("should transfer back staked tokens + rewards", async function () {
        const _b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        await dist.connect(anotherAccount).unstake($AMPL(30));
        const b = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        checkAmplAprox(b - _b, 57.36);
      });
    });

    describe("when multiple users stake many times", function () {
      // 10000 ampls locked for 1 year,
      // userA stakes 5000 ampls for 3/4 year, and 5000 ampls for 1/4 year
      // userb stakes 5000 ampls for 1/2 year and 3000 ampls for 1/4 year
      // userA unstakes 10000 ampls, gets 60.60% of the unlocked reward (4545 ampl)
      //        ~ [5000*0.75+5000*0.25 / (5000*0.75+5000*0.25+5000*0.5+3000*0.25) * 7500]
      // user's final balance is 14545 ampl
      // userb unstakes 8000 ampls, gets the 10955 ampl
      const rewardsAnotherAccount = 50000.0 / 11.0;
      const rewardsOwner = 32500.0 / 11.0;
      beforeEach(async function () {
        await dist.lockTokens($AMPL(10000), ONE_YEAR);
        await dist.connect(anotherAccount).stake($AMPL(5000));

        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.stake($AMPL(5000));
        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.connect(anotherAccount).stake($AMPL(5000));
        await dist.stake($AMPL(3000));
        await TimeHelpers.increaseTime(ONE_YEAR / 4);
        await dist.connect(anotherAccount).updateAccounting();
        await dist.updateAccounting();
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(18000));
        checkAmplAprox(await totalRewardsFor(anotherAccount), rewardsAnotherAccount / 2);
        checkAmplAprox(await totalRewardsFor(owner), rewardsOwner / 2);
      });
      it("should update the total staked and rewards", async function () {
        await dist.connect(anotherAccount).unstake($AMPL(10000));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(8000));
        expect(await dist.totalStakedBy.staticCall(ethers.ZeroAddress)).to.eq($AMPL(0));
        expect(await dist.totalStakedBy.staticCall(await owner.getAddress())).to.eq(
          $AMPL(8000),
        );
        checkAmplAprox(await totalRewardsFor(anotherAccount), 0);
        checkAmplAprox(await totalRewardsFor(owner), rewardsOwner / 2);
        await dist.unstake($AMPL(8000));
        expect(await dist.totalStaked.staticCall()).to.eq($AMPL(0));
        expect(
          await dist.totalStakedBy.staticCall(await anotherAccount.getAddress()),
        ).to.eq($AMPL(0));
        expect(await dist.totalStakedBy.staticCall(await owner.getAddress())).to.eq(
          $AMPL(0),
        );
        checkAmplAprox(await totalRewardsFor(anotherAccount), 0);
        checkAmplAprox(await totalRewardsFor(owner), 0);
      });
      it("should transfer back staked tokens + rewards", async function () {
        const b1 = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        await dist.connect(anotherAccount).unstake($AMPL(10000));
        const b2 = await ampl.balanceOf.staticCall(await anotherAccount.getAddress());
        checkAmplAprox(b2 - b1, 10000 + rewardsAnotherAccount);
        const b3 = await ampl.balanceOf.staticCall(await owner.getAddress());
        await dist.unstake($AMPL(8000));
        const b4 = await ampl.balanceOf.staticCall(await owner.getAddress());
        checkAmplAprox(b4 - b3, 8000 + rewardsOwner);
      });
    });
  });

  describe("unstakeQuery", function () {
    // 100 ampls locked for 1 year, user stakes 50 ampls for 1 year
    // user is eligible for 100% of the reward,
    // unstakes 30 ampls, gets 60% of the reward (60 ampl)
    beforeEach(async function () {
      await dist.lockTokens($AMPL(100), ONE_YEAR);
      await dist.connect(anotherAccount).stake($AMPL(50));
      await TimeHelpers.increaseTime(ONE_YEAR);
      await dist.connect(anotherAccount).updateAccounting();
    });
    it("should return the reward amount", async function () {
      checkAmplAprox(await totalRewardsFor(anotherAccount), 50);
      checkAmplAprox(
        await dist.connect(anotherAccount).unstake.staticCall($AMPL(30)),
        60,
      );
    });
  });
});
