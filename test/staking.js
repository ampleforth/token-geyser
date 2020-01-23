const { contract, web3 } = require('@openzeppelin/test-environment');
const { expectRevert, expectEvent, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const _require = require('app-root-path').require;
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);
const {
  $AMPL,
  invokeRebase
} = _require('/test/helper');

const AmpleforthErc20 = contract.fromArtifact('UFragments');
const TokenGeyser = contract.fromArtifact('TokenGeyser');

let ampl, dist, owner, anotherAccount;
describe('staking', function () {
  beforeEach('setup contracts', async function () {
    const accounts = await chain.getUserAccounts();
    owner = web3.utils.toChecksumAddress(accounts[0]);
    anotherAccount = web3.utils.toChecksumAddress(accounts[8]);

    ampl = await AmpleforthErc20.new();
    await ampl.initialize(owner);
    await ampl.setMonetaryPolicy(owner);

    const startBonus = 50;
    const bonusPeriod = 86400;
    dist = await TokenGeyser.new(ampl.address, ampl.address, 10, startBonus, bonusPeriod);
  });

  describe('when start bonus too high', function () {
    it('should fail to construct', async function () {
      await expectRevert(TokenGeyser.new(ampl.address, ampl.address, 10, 101, 86400),
        'TokenGeyser: start bonus too high');
    });
  });

  describe('when bonus period is 0', function () {
    it('should fail to construct', async function () {
      await expectRevert(TokenGeyser.new(ampl.address, ampl.address, 10, 50, 0),
        'TokenGeyser: bonus period is zero');
    });
  });

  describe('getStakingToken', function () {
    it('should return the staking token', async function () {
      expect(await dist.getStakingToken.call()).to.equal(ampl.address);
    });
  });

  describe('token', function () {
    it('should return the staking token', async function () {
      expect(await dist.token.call()).to.equal(ampl.address);
    });
  });

  describe('supportsHistory', function () {
    it('should return supportsHistory', async function () {
      expect(await dist.supportsHistory.call()).to.be.false;
    });
  });

  describe('stake', function () {
    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await ampl.approve(dist.address, $AMPL(1000));
        await expectRevert.unspecified(dist.stake($AMPL(0), []));
      });
    });

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await ampl.approve(dist.address, $AMPL(10));
        await expectRevert.unspecified(dist.stake($AMPL(100), []));
      });
    });

    describe('when totalStaked=0', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(0));
        await ampl.approve(dist.address, $AMPL(100));
      });
      it('should updated the total staked', async function () {
        await dist.stake($AMPL(100), []);
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(100));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($AMPL(100));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($AMPL(100));
      });
      it('should log Staked', async function () {
        const r = await dist.stake($AMPL(100), []);
        expectEvent(r, 'Staked', {
          user: owner,
          amount: $AMPL(100),
          total: $AMPL(100)
        });
      });
    });

    describe('when toatlStaked>0', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(0));
        await ampl.transfer(anotherAccount, $AMPL(50));
        await ampl.approve(dist.address, $AMPL(50), { from: anotherAccount });
        await dist.stake($AMPL(50), [], { from: anotherAccount });
        await ampl.approve(dist.address, $AMPL(150));
        await dist.stake($AMPL(150), []);
      });
      it('should updated the total staked', async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(200));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($AMPL(50));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($AMPL(150));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($AMPL(200));
      });
    });

    describe('when toatlStaked>0, rebase increases supply', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(0));
        await ampl.transfer(anotherAccount, $AMPL(50));
        await ampl.approve(dist.address, $AMPL(50), {
          from: anotherAccount
        });
        await dist.stake($AMPL(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, $AMPL(150));
        await invokeRebase(ampl, 100);
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(100));
        await dist.stake($AMPL(150), []);
      });
      it('should updated the total staked shares', async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(250));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($AMPL(100));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($AMPL(150));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($AMPL(125));
      });
    });

    describe('when toatlStaked>0, rebase decreases supply', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(0));
        await ampl.transfer(anotherAccount, $AMPL(50));
        await ampl.approve(dist.address, $AMPL(50), {
          from: anotherAccount
        });
        await dist.stake($AMPL(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, $AMPL(150));
        await invokeRebase(ampl, -50);
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(25));
        await dist.stake($AMPL(150), []);
      });
      it('should updated the total staked shares', async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(175));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($AMPL(25));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($AMPL(150));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($AMPL(350));
      });
    });
  });

  describe('stakeFor', function () {
    describe('when the beneficiary is ZERO_ADDRESS', function () {
      it('should fail', async function () {
        await expectRevert(dist.stakeFor(constants.ZERO_ADDRESS, $AMPL(100), []),
          'TokenGeyser: beneficiary is zero address');
      });
    });

    describe('when the beneficiary is a valid address', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(0));
        await ampl.approve(dist.address, $AMPL(100));
      });
      it('should deduct ampls for the staker', async function () {
        const b = await ampl.balanceOf.call(owner);
        await dist.stakeFor(anotherAccount, $AMPL(100), []);
        const b_ = await ampl.balanceOf.call(owner);
        expect(b.sub(b_)).to.be.bignumber.equal($AMPL(100));
      });
      it('should updated the total staked on behalf of the beneficiary', async function () {
        await dist.stakeFor(anotherAccount, $AMPL(100), []);
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($AMPL(100));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($AMPL(100));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($AMPL(0));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($AMPL(100));
      });
      it('should log Staked', async function () {
        const r = await dist.stakeFor(anotherAccount, $AMPL(100), []);
        expectEvent(r, 'Staked', {
          user: anotherAccount,
          amount: $AMPL(100),
          total: $AMPL(100)
        });
      });
    });
  });
});
