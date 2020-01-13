const BigNumber = web3.BigNumber;
require('chai').use(require('chai-bignumber')(BigNumber)).should();

const _require = require('app-root-path').require;
const { checkAproxBal, toAmplDecimalsStr, invokeRebase } = _require('/test/helper');
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);

const AmpleforthErc20 = artifacts.require('uFragments/UFragments.sol');
const TokenGeyser = artifacts.require('TokenGeyser.sol');

const ONE_YEAR = 1 * 365 * 24 * 3600;

let ampl, dist, owner, anotherAccount, r, _b;
async function setupContractAndAccounts (accounts) {
  owner = accounts[0];
  anotherAccount = accounts[8];

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  const startBonus = 50; // 50%
  const bonusPeriod = 86400; // 1 Day
  dist = await TokenGeyser.new(ampl.address, ampl.address, 10, startBonus, bonusPeriod);

  await ampl.transfer(anotherAccount, toAmplDecimalsStr(1000));
  await ampl.approve(dist.address, toAmplDecimalsStr(1000), { from: anotherAccount });
  await ampl.approve(dist.address, toAmplDecimalsStr(1000), { from: owner });
}

async function totalRewardsFor (account) {
  return (await dist.updateAccounting.call({ from: account }))[4];
}

contract('unstaking', function (accounts) {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts(accounts);
  });

  describe('unstake', function () {
    describe('when amount is 0', function () {
      it('should fail', async function () {
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        expect(await chain.isEthException(
          dist.unstake(toAmplDecimalsStr(0), [], { from: anotherAccount })
        )).to.be.true;
      });
    });

    describe('when rebase decreases supply', function () {
      beforeEach(async function () {
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(1);
      });
      it('should fail if user tries to unstake more than his balance', async function () {
        await invokeRebase(ampl, -50);
        expect(await chain.isEthException(
          dist.unstake(toAmplDecimalsStr(50), [], { from: anotherAccount })
        )).to.be.true;
      });
      it('should NOT fail if user tries to unstake his balance', async function () {
        await invokeRebase(ampl, -50);
        expect(await chain.isEthException(
          dist.unstake(toAmplDecimalsStr(25), [], { from: anotherAccount })
        )).to.be.false;
      });
    });

    describe('when single user stakes once', function () {
      // 100 ampls locked for 1 year, user stakes 50 ampls for 1 year
      // user is eligible for 100% of the reward,
      // unstakes 30 ampls, gets 60% of the reward (60 ampl)
      // user's final balance is 90 ampl, (20 remains staked), eligible rewards (40 ampl)
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR);
        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(totalRewardsFor(anotherAccount), 100);
        _b = await ampl.balanceOf.call(anotherAccount);
        r = await dist.unstake(toAmplDecimalsStr(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(20));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(20));
        await checkAproxBal(totalRewardsFor(anotherAccount), 40);
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 90);
      });
      it('should log Unstaked', async function () {
        const l = r.logs[r.logs.length - 2];
        expect(l.event).to.eql('Unstaked');
        expect(l.args.user).to.eql(anotherAccount);
        (l.args.amount).should.be.bignumber.eq(toAmplDecimalsStr(30));
        (l.args.total).should.be.bignumber.eq(toAmplDecimalsStr(20));
      });
      it('should log TokensClaimed', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('TokensClaimed');
        expect(l.args.user).to.eql(anotherAccount);
        await checkAproxBal(l.args.amount, 60);
      });
    });

    describe('when single user unstake early with early bonus', function () {
      // Start bonus = 50%, Bonus Period = 1 Day.
      // 100 ampls locked for 1 hour, so all will be unlocked by test-time.
      // user stakes 50 ampls for 12 hours, half the period.
      // user is eligible for 75% of the max reward,
      // unstakes 25 ampls, gets .5 * .75 * 100 ampls
      // user's final balance is 62.5 ampl, (25 remains staked), eligible rewards (37.5 ampl)
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimalsStr(100), 1 * 60 * 60);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(12 * 60 * 60);
        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(totalRewardsFor(anotherAccount), 100);
        _b = await ampl.balanceOf.call(anotherAccount);
        r = await dist.unstake(toAmplDecimalsStr(25), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(25));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(25));
        await checkAproxBal(totalRewardsFor(anotherAccount), 62.5); // (.5 * .75 * 100) + 25
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 62.5);
      });
      it('should log Unstaked', async function () {
        const l = r.logs[r.logs.length - 2];
        expect(l.event).to.eql('Unstaked');
        expect(l.args.user).to.eql(anotherAccount);
        (l.args.amount).should.be.bignumber.eq(toAmplDecimalsStr(25));
        (l.args.total).should.be.bignumber.eq(toAmplDecimalsStr(25));
      });
      it('should log TokensClaimed', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('TokensClaimed');
        expect(l.args.user).to.eql(anotherAccount);
        await checkAproxBal(l.args.amount, 37.5); // .5 * .75 * 100
      });
    });

    describe('when single user stakes many times', function () {
      // 100 ampls locked for 1 year,
      // user stakes 50 ampls for 1/2 year, 50 ampls for 1/4 year, [50 ampls unlocked in this time ]
      // unstakes 30 ampls, gets 20% of the unlocked reward (10 ampl) ~ [30 * 0.25 / (50*0.25+50*0.5) * 50]
      // user's final balance is 40 ampl
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(totalRewardsFor(anotherAccount), 50);
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimalsStr(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(70));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(70));
        await checkAproxBal(totalRewardsFor(anotherAccount), 40);
      });
      it('should transfer back staked tokens + rewards', async function () {
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 40);
      });
    });

    describe('when single user performs unstake many times', function () {
      // 100 ampls locked for 1 year,
      // user stakes 10 ampls, waits 1 year, stakes 10 ampls, waits 1 year, unstakes 5 ampl, unstakes 5 ampl, unstakes 5 ampl
      // 3rd unstake should be worth twice the first one
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);

        await dist.stake(toAmplDecimalsStr(10), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR);
        await dist.stake(toAmplDecimalsStr(10), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR);

        await dist.updateAccounting({ from: anotherAccount });
        await checkAproxBal(totalRewardsFor(anotherAccount), 100);

        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimalsStr(5), [], { from: anotherAccount });
      });

      it('should use updated user accounting', async function () {
        r = await dist.unstake(toAmplDecimalsStr(5), [], { from: anotherAccount });
        const l1 = r.logs[r.logs.length - 1];
        expect(l1.event).to.eql('TokensClaimed');
        expect(l1.args.user).to.eql(anotherAccount);
        const claim2 = l1.args.amount;

        r = await dist.unstake(toAmplDecimalsStr(5), [], { from: anotherAccount });
        const l2 = r.logs[r.logs.length - 1];
        expect(l2.event).to.eql('TokensClaimed');
        expect(l2.args.user).to.eql(anotherAccount);
        const claim3 = l2.args.amount;

        const ratio = claim3.div(claim2);
        ratio.should.be.bignumber.above('1.999999').and.bignumber.below('2.000001');
      });
    });

    describe('when multiple users stake once', function () {
      // 100 ampls locked for 1 year,
      // userA stakes 50 ampls for 3/4 year, userb stakes 50 ampl for 1/2 year, total unlocked 75 ampl
      // userA unstakes 30 ampls, gets 36% of the unlocked reward (27 ampl) ~ [30 * 0.75 / (50*0.75+50*0.5) * 75]
      // user's final balance is 57 ampl
      beforeEach(async function () {
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimalsStr(50), []);
        await chain.waitForSomeTime(ONE_YEAR / 2);
        await dist.updateAccounting({ from: anotherAccount });
        await dist.updateAccounting();
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        await checkAproxBal(totalRewardsFor(anotherAccount), 45);
        await checkAproxBal(totalRewardsFor(owner), 30);
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimalsStr(30), [], { from: anotherAccount });
      });
      it('should update the total staked and rewards', async function () {
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(70));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(20));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(50));
        await checkAproxBal(totalRewardsFor(anotherAccount), 18);
        await checkAproxBal(totalRewardsFor(owner), 30);
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
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimalsStr(50), []);
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
        await dist.stake(toAmplDecimalsStr(30), []);
        await chain.waitForSomeTime(ONE_YEAR / 4);
        await dist.updateAccounting({ from: anotherAccount });
        await dist.updateAccounting();
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(180));
        await checkAproxBal(totalRewardsFor(anotherAccount), 45.45);
        await checkAproxBal(totalRewardsFor(owner), 29.55);
      });
      it('should update the total staked and rewards', async function () {
        await dist.unstake(toAmplDecimalsStr(100), [], { from: anotherAccount });
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(80));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(0));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(80));
        await checkAproxBal(totalRewardsFor(anotherAccount), 0);
        await checkAproxBal(totalRewardsFor(owner), 29.55);

        await dist.unstake(toAmplDecimalsStr(80), []);
        (await dist.totalStaked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        (await dist.totalStakedFor.call(anotherAccount)).should.be.bignumber.eq(toAmplDecimalsStr(0));
        (await dist.totalStakedFor.call(owner)).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await checkAproxBal(totalRewardsFor(anotherAccount), 0);
        await checkAproxBal(totalRewardsFor(owner), 0);
      });
      it('should transfer back staked tokens + rewards', async function () {
        _b = await ampl.balanceOf.call(anotherAccount);
        await dist.unstake(toAmplDecimalsStr(100), [], { from: anotherAccount });
        await checkAproxBal((await ampl.balanceOf.call(anotherAccount)).sub(_b), 145.45);
        _b = await ampl.balanceOf.call(owner);
        await dist.unstake(toAmplDecimalsStr(80), []);
        await checkAproxBal((await ampl.balanceOf.call(owner)).sub(_b), 109.55);
      });
    });
  });

  describe('unstakeQuery', function () {
    // 100 ampls locked for 1 year, user stakes 50 ampls for 1 year
    // user is eligible for 100% of the reward,
    // unstakes 30 ampls, gets 60% of the reward (60 ampl)
    beforeEach(async function () {
      await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
      await dist.stake(toAmplDecimalsStr(50), [], { from: anotherAccount });
      await chain.waitForSomeTime(ONE_YEAR);
      await dist.updateAccounting({ from: anotherAccount });
    });
    it('should return the reward amount', async function () {
      await checkAproxBal(totalRewardsFor(anotherAccount), 100);
      const a = dist.unstakeQuery.call(toAmplDecimalsStr(30), { from: anotherAccount });
      await checkAproxBal(a, 60);
    });
  });
});
