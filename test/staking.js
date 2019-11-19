const BigNumber = web3.BigNumber;
require('chai').use(require('chai-bignumber')(BigNumber)).should();

const _require = require('app-root-path').require;
const { toAmplDecimalsStr, invokeRebase } = _require('/test/helper');

const AmpleforthErc20 = artifacts.require('uFragments/UFragments.sol');
const ContVestTokenDist = artifacts.require('ContVestTokenDist.sol');

let ampl, dist, owner, anotherAccount, r;
async function setupContractAndAccounts (accounts) {
  owner = accounts[0];
  anotherAccount = accounts[8];

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  dist = await ContVestTokenDist.new(ampl.address, ampl.address, 10);
}

contract('staking', function (accounts) {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts(accounts);
  });

  describe('stake', function () {
    describe('when toatlStaked=0', function () {
      beforeEach(async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await ampl.approve(dist.address, toAmplDecimalsStr(100));
        r = await dist.stake(toAmplDecimalsStr(100), []);
      });
      it('should updated the total staked', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(100));
      });
      it('should log Staked', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('Staked');
        expect(l.args.user).to.eql(owner);
        (l.args.amount).should.be.bignumber.eq(toAmplDecimalsStr(100));
        (l.args.total).should.be.bignumber.eq(toAmplDecimalsStr(100));
      });
    });

    describe('when toatlStaked>0', function () {
      beforeEach(async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await ampl.transfer(anotherAccount, toAmplDecimalsStr(50));
        await ampl.approve(dist.address, toAmplDecimalsStr(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimalsStr(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await dist.stake(toAmplDecimalsStr(150), []);
      });
      it('should updated the total staked', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(200));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(50));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(150));
      });
    });

    describe('when toatlStaked>0, rebase increases supply', function () {
      beforeEach(async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await ampl.transfer(anotherAccount, toAmplDecimalsStr(50));
        await ampl.approve(dist.address, toAmplDecimalsStr(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimalsStr(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await invokeRebase(ampl, 100);
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        await dist.stake(toAmplDecimalsStr(150), []);
      });
      it('should updated the total staked shares', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(250));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(100));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(150));
      });
    });

    describe('when toatlStaked>0, rebase decreases supply', function () {
      beforeEach(async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await ampl.transfer(anotherAccount, toAmplDecimalsStr(50));
        await ampl.approve(dist.address, toAmplDecimalsStr(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimalsStr(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await invokeRebase(ampl, -50);
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(25));
        await dist.stake(toAmplDecimalsStr(150), []);
      });
      it('should updated the total staked shares', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(175));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(25));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(150));
      });
    });
  });
});
