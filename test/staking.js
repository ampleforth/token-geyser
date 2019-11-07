const BN = require('bn.js');
const chai = require('chai');
chai.use(require('bn-chai')(BN));
expect = chai.expect;

const _require = require('app-root-path').require;
const { toAmplDecimals, invokeRebase } = _require('/test/helper');

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
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(0));
        await ampl.approve(dist.address, toAmplDecimals(100));
        r = await dist.stake(toAmplDecimals(100), []);
      });
      it('should updated the total staked', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(100));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(100));
      });
      it('should log Staked', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('Staked');
        expect(l.args.user).to.eql(owner);
        expect(l.args.amount).to.eq.BN(toAmplDecimals(100));
        expect(l.args.total).to.eq.BN(toAmplDecimals(100));
      });
    });

    describe('when toatlStaked>0', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(0));
        await ampl.transfer(anotherAccount, toAmplDecimals(50));
        await ampl.approve(dist.address, toAmplDecimals(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimals(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimals(150));
        await dist.stake(toAmplDecimals(150), []);
      });
      it('should updated the total staked', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(200));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(50));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(150));
      });
    });

    describe('when toatlStaked>0, rebase increases supply', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(0));
        await ampl.transfer(anotherAccount, toAmplDecimals(50));
        await ampl.approve(dist.address, toAmplDecimals(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimals(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimals(150));
        await invokeRebase(ampl, 100);
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(100));
        await dist.stake(toAmplDecimals(150), []);
      });
      it('should updated the total staked shares', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(250));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(100));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(150));
      });
    });

    describe('when toatlStaked>0, rebase decreases supply', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(0));
        await ampl.transfer(anotherAccount, toAmplDecimals(50));
        await ampl.approve(dist.address, toAmplDecimals(50), {
          from: anotherAccount
        });
        await dist.stake(toAmplDecimals(50), [], {
          from: anotherAccount
        });
        await ampl.approve(dist.address, toAmplDecimals(150));
        await invokeRebase(ampl, -50);
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(25));
        await dist.stake(toAmplDecimals(150), []);
      });
      it('should updated the total staked shares', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(175));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(25));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(150));
      });
    });
  });
});
