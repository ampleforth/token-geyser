const BN = require('bn.js');
const chai = require('chai');
chai.use(require('bn-chai')(BN));
expect = chai.expect;

const _require = require('app-root-path').require;
const { toAmplDecimals, invokeRebase } = _require('/test/helper');
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);

const AmpleforthErc20 = artifacts.require('uFragments/UFragments.sol');
const ContVestTokenDist = artifacts.require('ContVestTokenDist.sol');

const ONE_YEAR = 1 * 365 * 24 * 3600;

let ampl, dist, owner, anotherAccount, r, _b;
async function setupContractAndAccounts (accounts) {
  owner = accounts[0];
  anotherAccount = accounts[8];

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  dist = await ContVestTokenDist.new(ampl.address, ampl.address, 10);

  await ampl.transfer(anotherAccount, toAmplDecimals(1000));
  await ampl.approve(dist.address, toAmplDecimals(1000), { from: anotherAccount });
  await ampl.approve(dist.address, toAmplDecimals(1000), { from: owner });
}

async function checkAproxBal (x, y) {
  const delta = toAmplDecimals(1).div(new BN(10));
  expect(await x).to.gt.BN(toAmplDecimals(y).sub(delta));
  expect(await x).to.lt.BN(toAmplDecimals(y).add(delta));
}

contract('unstaking', function (accounts) {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts(accounts);
  });

  describe('unstake', function () {
    describe('when rebase decreases supply', function () {
      beforeEach(async function () {
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(1);
      });
      it('should fail if user tries to unstake more than his balance', async function () {
        await invokeRebase(ampl, -50);
        expect(await chain.isEthException(
          dist.unstake(toAmplDecimals(50), [], { from: anotherAccount })
        )).to.be.true;
      });
      it('should NOT fail if user tries to unstake his balance', async function () {
        await invokeRebase(ampl, -50);
        expect(await chain.isEthException(
          dist.unstake(toAmplDecimals(25), [], { from: anotherAccount })
        )).to.be.false;
      });
    });

    describe('when single user stakes once', function () {
      // 100 ampls locked for 1 year, user stakes 50 ampls for 1 year
      // user is eligible for 100% of the reward,
      // unstakes 30 ampls, gets 60% of the reward (60 ampl)
      // user's final balance is 90 ampl, (20 remians staked), eligible rewards (40 ampl)
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR);
        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 100);
        _b = await ampl.balanceOf.call(anotherAccount);
        r = await dist.unstake(toAmplDecimals(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(20));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(20));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 40);
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 90);
      });
      it('should log Unstaked', async function () {
        const l = r.logs[1];
        expect(l.event).to.eql('Unstaked');
        expect(l.args.user).to.eql(anotherAccount);
        expect(l.args.amount).to.eq.BN(toAmplDecimals(30));
        expect(l.args.total).to.eq.BN(toAmplDecimals(20));
      });
      it('should log TokensClaimed', async function () {
        const l = r.logs[2];
        expect(l.event).to.eql('TokensClaimed');
        expect(l.args.user).to.eql(anotherAccount);
        await checkAproxBal(l.args.amount, 60);
      });
    });

    describe('when single user stakes many times', function () {
      // 100 ampls locked for 1 year,
      // user stakes 50 ampls for 1/2 year, 50 ampls for 1/4 year, [50 ampls unlocked in this time ]
      // unstakes 30 ampls, gets 20% of the unlocked reward (10 ampl) ~ [30 * 0.25 / (50*0.25+50*0.5) * 50]
      // user's final balance is 40 ampl
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 50);
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimals(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(70));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(70));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 40);
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 40);
      });
    });

    describe('when multiple users stake once', function () {
      // 100 ampls locked for 1 year,
      // userA stakes 50 ampls for 3/4 year, userb stakes 50 ampl for 1/2 year, total unlocked 75 ampl
      // userA unstakes 30 ampls, gets 36% of the unlocked reward (27 ampl) ~ [30 * 0.75 / (50*0.75+50*0.5) * 75]
      // user's final balance is 57 ampl
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimals(50), []);
        await chain.waitForSomeTime(ONE_YEAR / 2);
        await dist.updateAccounting({ from: anotherAccount });
        await dist.updateAccounting();
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(100));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 45);
        await checkAproxBal(dist.totalRewardsFor.call(owner), 30);
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimals(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(70));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(20));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(50));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 18);
        await checkAproxBal(dist.totalRewardsFor.call(owner), 30);
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 57);
      });
    });

    describe('when multiple users stake many times', function () {
      // 100 ampls locked for 1 year,
      // userA stakes 50 ampls for 3/4 year, and 50 ampls for 1/4 year
      // userb stakes 50 ampls for 1/2 year and 30 ampls for 1/4 year
      // userA unstakes 100 ampls, gets 60.60% of the unlocked reward (45.45 ampl) ~ [50*0.75+50*0.25 / (50*0.75+50*0.25+50*0.5+30*0.25) * 75]
      // user's final balance is 145.45 ampl
      // userb unstakes 80 ampls, gets the 109.55 ampl
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimals(50), []);
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimals(50), [], { from: anotherAccount });
        await dist.stake(toAmplDecimals(30), []);
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.updateAccounting({ from: anotherAccount });
        await dist.updateAccounting();
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(180));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 45.45);
        await checkAproxBal(dist.totalRewardsFor.call(owner), 29.55);
      });
      it('should update the total staked and rewards', async function () {
        await dist.unstake(toAmplDecimals(100), [], { from: anotherAccount });
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(80));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(0));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(80));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 0);
        await checkAproxBal(dist.totalRewardsFor.call(owner), 29.55);

        await dist.unstake(toAmplDecimals(80), []);
        expect(await dist.totalStaked.call()).to.eq.BN(toAmplDecimals(0));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.eq.BN(toAmplDecimals(0));
        expect(await dist.totalStakedFor.call(owner)).to.eq.BN(toAmplDecimals(0));
        await checkAproxBal(dist.totalRewardsFor.call(anotherAccount), 0);
        await checkAproxBal(dist.totalRewardsFor.call(owner), 0);
      });
      it('should transfer back staked tokens + rewards', async function () {
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimals(100), [], { from: anotherAccount });
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 145.45);
        _b = await ampl.balanceOf.call(owner);
        await dist.unstake(toAmplDecimals(80), []);
        await checkAproxBal((await ampl.balanceOf.call(owner)).sub(_b), 109.55);
      });
    });
  });
});
