const { contract, web3 } = require('@openzeppelin/test-environment');
const { expectRevert, expectEvent } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const _require = require('app-root-path').require;
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);

const MockERC20 = contract.fromArtifact('MockERC20');
const TokenPool = contract.fromArtifact('TokenPool');

let token, otherToken, tokenPool, owner, anotherAccount;
describe('tokenPool', function () {
  beforeEach('setup contracts', async function () {
    const accounts = await chain.getUserAccounts();
    owner = web3.utils.toChecksumAddress(accounts[0]);
    anotherAccount = web3.utils.toChecksumAddress(accounts[8]);

    token = await MockERC20.new(1000);
    otherToken = await MockERC20.new(2000);

    tokenPool = await TokenPool.new(token.address);
  });

  describe('balance', function() {
    it('should return the balance of the token pool', async function(){
      await token.transfer(tokenPool.address, 123);
      expect(await tokenPool.balance.call()).to.be.bignumber.equal('123');
      await tokenPool.transfer(owner, 99);
      expect(await tokenPool.balance.call()).to.be.bignumber.equal('24');
      await tokenPool.transfer(owner, 24);
      expect(await tokenPool.balance.call()).to.be.bignumber.equal('0');
    });
  });

  describe('transfer', function() {
    it('should let the owner transfer funds out', async function(){
      await token.transfer(tokenPool.address, 1000);

      expect(await tokenPool.balance.call()).to.be.bignumber.equal('1000');
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');

      await tokenPool.transfer(anotherAccount, 1000);

      expect(await tokenPool.balance.call()).to.be.bignumber.equal('0');
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('1000');
    });

    it('should NOT let other users transfer funds out', async function(){
      await token.transfer(tokenPool.address, 1000);
      await expectRevert(
        tokenPool.transfer(anotherAccount, 1000, { from: anotherAccount }),
        'Ownable: caller is not the owner'
      );
    });
  });

  describe('rescueFunds', function() {
    beforeEach(async function(){
      await token.transfer(tokenPool.address, 1000);
      await otherToken.transfer(tokenPool.address, 2000);

      expect(await tokenPool.balance.call()).to.be.bignumber.equal('1000');
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');
      expect(await otherToken.balanceOf.call(tokenPool.address)).to.be.bignumber.equal('2000');
      expect(await otherToken.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');
    });

    it('should let owner users claim excess funds completely', async function(){
      await tokenPool.rescueFunds(otherToken.address, anotherAccount, 2000);

      expect(await tokenPool.balance.call()).to.be.bignumber.equal('1000');
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');
      expect(await otherToken.balanceOf.call(tokenPool.address)).to.be.bignumber.equal('0');
      expect(await otherToken.balanceOf.call(anotherAccount)).to.be.bignumber.equal('2000');
    });

    it('should let owner users claim excess funds partially', async function(){
      await tokenPool.rescueFunds(otherToken.address, anotherAccount, 777);

      expect(await tokenPool.balance.call()).to.be.bignumber.equal('1000');
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');
      expect(await otherToken.balanceOf.call(tokenPool.address)).to.be.bignumber.equal('1223');
      expect(await otherToken.balanceOf.call(anotherAccount)).to.be.bignumber.equal('777');
    });

    it('should NOT let owner claim more than available excess funds', async function(){
      await expectRevert(
        tokenPool.rescueFunds(otherToken.address, anotherAccount, 2001),
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('should NOT let owner users claim held funds', async function(){
      await expectRevert(
        tokenPool.rescueFunds(token.address, anotherAccount, 1000),
        'TokenPool: Cannot claim token held by the contract'
      );
    });

    it('should NOT let other users users claim excess funds', async function(){
      await expectRevert(
        tokenPool.rescueFunds(otherToken.address, anotherAccount, 2000, { from: anotherAccount }),
        'Ownable: caller is not the owner'
      );
    });
  });
});
