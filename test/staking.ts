import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { TimeHelpers, $AMPL, invokeRebase } from "../test/helper";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

let ampl: any, dist: any, owner: SignerWithAddress, anotherAccount: SignerWithAddress;
const InitialSharesPerToken = BigInt(10 ** 6);

describe("staking", function () {
  async function setupContracts() {
    [owner, anotherAccount] = await ethers.getSigners();

    const AmpleforthErc20 = await ethers.getContractFactory("UFragments");
    ampl = await AmpleforthErc20.deploy();
    await ampl.initialize(await owner.getAddress());
    await ampl.setMonetaryPolicy(await owner.getAddress());

    const TokenGeyser = await ethers.getContractFactory("TokenGeyser");
    dist = await TokenGeyser.deploy(
      ampl.target,
      ampl.target,
      10,
      50,
      86400,
      InitialSharesPerToken,
    );

    return { ampl, dist, owner, anotherAccount };
  }

  beforeEach(async function () {
    ({ ampl, dist, owner, anotherAccount } = await loadFixture(setupContracts));
  });

  describe("when start bonus too high", function () {
    it("should fail to construct", async function () {
      const TokenGeyser = await ethers.getContractFactory("TokenGeyser");
      await expect(
        TokenGeyser.deploy(
          ampl.target,
          ampl.target,
          10,
          101,
          86400,
          InitialSharesPerToken,
        ),
      ).to.be.revertedWith("TokenGeyser: start bonus too high");
    });
  });

  describe("when bonus period is 0", function () {
    it("should fail to construct", async function () {
      const TokenGeyser = await ethers.getContractFactory("TokenGeyser");
      await expect(
        TokenGeyser.deploy(ampl.target, ampl.target, 10, 50, 0, InitialSharesPerToken),
      ).to.be.revertedWith("TokenGeyser: bonus period is zero");
    });
  });

  describe("getStakingToken", function () {
    it("should return the staking token", async function () {
      expect(await dist.getStakingToken()).to.equal(ampl.target);
    });
  });

  describe("token", function () {
    it("should return the staking token", async function () {
      expect(await dist.token()).to.equal(ampl.target);
    });
  });

  describe("supportsHistory", function () {
    it("should return supportsHistory", async function () {
      expect(await dist.supportsHistory()).to.be.false;
    });
  });

  describe("stake", function () {
    describe("when the amount is 0", function () {
      it("should fail", async function () {
        await ampl.approve(dist.target, $AMPL(1000));
        await expect(dist.stake($AMPL(0), "0x")).to.be.revertedWith(
          "TokenGeyser: stake amount is zero",
        );
      });
    });

    describe("when token transfer has not been approved", function () {
      it("should fail", async function () {
        await expect(dist.stake($AMPL(100), "0x")).to.be.reverted;
      });
    });

    describe("when totalStaked=0", function () {
      beforeEach(async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(0));
        await ampl.approve(dist.target, $AMPL(100));
      });
      it("should update the total staked", async function () {
        await dist.stake($AMPL(100), "0x");
        expect(await dist.totalStaked()).to.equal($AMPL(100));
        expect(await dist.totalStakedFor(await owner.getAddress())).to.equal($AMPL(100));
        expect(await dist.totalStakingShares()).to.equal(
          $AMPL(100) * InitialSharesPerToken,
        );
      });
      it("should log Staked", async function () {
        const tx = await dist.stake($AMPL(100), "0x");
        await expect(tx)
          .to.emit(dist, "Staked")
          .withArgs(await owner.getAddress(), $AMPL(100), $AMPL(100), "0x");
      });
    });

    describe("when totalStaked>0", function () {
      beforeEach(async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(0));
        await ampl.transfer(await anotherAccount.getAddress(), $AMPL(50));
        await ampl.connect(anotherAccount).approve(dist.target, $AMPL(50));
        await dist.connect(anotherAccount).stake($AMPL(50), "0x");
        await ampl.approve(dist.target, $AMPL(150));
        await dist.stake($AMPL(150), "0x");
      });
      it("should update the total staked", async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(200));
        expect(await dist.totalStakedFor(await anotherAccount.getAddress())).to.equal(
          $AMPL(50),
        );
        expect(await dist.totalStakedFor(await owner.getAddress())).to.equal($AMPL(150));
        expect(await dist.totalStakingShares()).to.equal(
          $AMPL(200) * InitialSharesPerToken,
        );
      });
    });

    describe("when totalStaked>0, rebase increases supply", function () {
      beforeEach(async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(0));
        await ampl.transfer(await anotherAccount.getAddress(), $AMPL(50));
        await ampl.connect(anotherAccount).approve(dist.target, $AMPL(50));
        await dist.connect(anotherAccount).stake($AMPL(50), "0x");
        await ampl.approve(dist.target, $AMPL(150));
        await invokeRebase(ampl, 100);
        expect(await dist.totalStaked()).to.equal($AMPL(100));
        await dist.stake($AMPL(150), "0x");
      });
      it("should updated the total staked shares", async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(250));
        expect(await dist.totalStakedFor(await anotherAccount.getAddress())).to.equal(
          $AMPL(100),
        );
        expect(await dist.totalStakedFor(await owner.getAddress())).to.equal($AMPL(150));
        expect(await dist.totalStakingShares()).to.equal(
          $AMPL(125) * InitialSharesPerToken,
        );
      });
    });

    describe("when totalStaked>0, when rebase increases supply", function () {
      beforeEach(async function () {
        await ampl.approve(dist.target, $AMPL(51));
        await dist.stake($AMPL(50), "0x");
      });
      it("should fail if there are too few mintedStakingShares", async function () {
        await invokeRebase(ampl, 100n * InitialSharesPerToken);
        await expect(dist.stake(1, "0x")).to.be.revertedWith(
          "TokenGeyser: Stake amount is too small",
        );
      });
    });

    describe("when totalStaked>0, rebase decreases supply", function () {
      beforeEach(async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(0));
        await ampl.transfer(await anotherAccount.getAddress(), $AMPL(50));
        await ampl.connect(anotherAccount).approve(dist.target, $AMPL(50));
        await dist.connect(anotherAccount).stake($AMPL(50), "0x");
        await ampl.approve(dist.target, $AMPL(150));
        await invokeRebase(ampl, -50);
        expect(await dist.totalStaked()).to.equal($AMPL(25));
        await dist.stake($AMPL(150), "0x");
      });
      it("should updated the total staked shares", async function () {
        expect(await dist.totalStaked()).to.equal($AMPL(175));
        expect(await dist.totalStakedFor(await anotherAccount.getAddress())).to.equal(
          $AMPL(25),
        );
        expect(await dist.totalStakedFor(await owner.getAddress())).to.equal($AMPL(150));
        expect(await dist.totalStakingShares()).to.equal(
          $AMPL(350) * InitialSharesPerToken,
        );
      });
    });
  });
});
