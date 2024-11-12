import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

let owner: SignerWithAddress, anotherAccount: SignerWithAddress;

describe("TokenPool", function () {
  async function setupContracts() {
    [owner, anotherAccount] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy(1000);
    const otherToken = await MockERC20.deploy(2000);

    const TokenPool = await ethers.getContractFactory("TokenPool");
    const tokenPool = await TokenPool.deploy(token.target);

    return { token, otherToken, tokenPool, owner, anotherAccount };
  }

  describe("balance", function () {
    it("should return the balance of the token pool", async function () {
      const { token, tokenPool, owner } = await loadFixture(setupContracts);

      await token.transfer(tokenPool.target, 123);
      expect(await tokenPool.balance()).to.equal(123);
      await tokenPool.transfer(await owner.getAddress(), 99);
      expect(await tokenPool.balance()).to.equal(24);
      await tokenPool.transfer(await owner.getAddress(), 24);
      expect(await tokenPool.balance()).to.equal(0);
    });
  });

  describe("transfer", function () {
    it("should let the owner transfer funds out", async function () {
      const { token, tokenPool, anotherAccount } = await loadFixture(setupContracts);

      await token.transfer(tokenPool.target, 1000);

      expect(await tokenPool.balance()).to.equal(1000);
      expect(await token.balanceOf(await anotherAccount.getAddress())).to.equal(0);

      await tokenPool.transfer(await anotherAccount.getAddress(), 1000);

      expect(await tokenPool.balance()).to.equal(0);
      expect(await token.balanceOf(await anotherAccount.getAddress())).to.equal(1000);
    });

    it("should NOT let other users transfer funds out", async function () {
      const { token, tokenPool, anotherAccount } = await loadFixture(setupContracts);

      await token.transfer(tokenPool.target, 1000);
      await expect(
        tokenPool
          .connect(anotherAccount)
          .transfer(await anotherAccount.getAddress(), 1000),
      ).to.be.revertedWithCustomError(tokenPool, "OwnableUnauthorizedAccount");
    });
  });

  describe("rescueFunds", function () {
    it("should let owner users claim excess funds completely", async function () {
      const { token, otherToken, tokenPool, anotherAccount } = await loadFixture(
        setupContracts,
      );

      await token.transfer(tokenPool.target, 1000);
      await otherToken.transfer(tokenPool.target, 2000);

      await tokenPool.rescueFunds(
        otherToken.target,
        await anotherAccount.getAddress(),
        2000,
      );

      expect(await tokenPool.balance()).to.equal(1000);
      expect(await token.balanceOf(await anotherAccount.getAddress())).to.equal(0);
      expect(await otherToken.balanceOf(tokenPool.target)).to.equal(0);
      expect(await otherToken.balanceOf(await anotherAccount.getAddress())).to.equal(
        2000,
      );
    });

    it("should let owner users claim excess funds partially", async function () {
      const { token, otherToken, tokenPool, anotherAccount } = await loadFixture(
        setupContracts,
      );

      await token.transfer(tokenPool.target, 1000);
      await otherToken.transfer(tokenPool.target, 2000);

      await tokenPool.rescueFunds(
        otherToken.target,
        await anotherAccount.getAddress(),
        777,
      );

      expect(await tokenPool.balance()).to.equal(1000);
      expect(await token.balanceOf(await anotherAccount.getAddress())).to.equal(0);
      expect(await otherToken.balanceOf(tokenPool.target)).to.equal(1223);
      expect(await otherToken.balanceOf(await anotherAccount.getAddress())).to.equal(777);
    });

    it("should NOT let owner claim more than available excess funds", async function () {
      const { otherToken, tokenPool, anotherAccount } = await loadFixture(setupContracts);

      await otherToken.transfer(tokenPool.target, 2000);

      await expect(
        tokenPool.rescueFunds(otherToken.target, await anotherAccount.getAddress(), 2001),
      ).to.be.revertedWithCustomError(otherToken, "ERC20InsufficientBalance");
    });

    it("should NOT let owner users claim held funds", async function () {
      const { token, tokenPool, anotherAccount } = await loadFixture(setupContracts);

      await token.transfer(tokenPool.target, 1000);

      await expect(
        tokenPool.rescueFunds(token.target, await anotherAccount.getAddress(), 1000),
      ).to.be.revertedWith("TokenPool: Cannot claim token held by the contract");
    });

    it("should NOT let other users claim excess funds", async function () {
      const { otherToken, tokenPool, anotherAccount } = await loadFixture(setupContracts);

      await otherToken.transfer(tokenPool.target, 2000);

      await expect(
        tokenPool
          .connect(anotherAccount)
          .rescueFunds(otherToken.target, await anotherAccount.getAddress(), 2000),
      ).to.be.revertedWithCustomError(tokenPool, "OwnableUnauthorizedAccount");
    });
  });
});
