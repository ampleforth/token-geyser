const { contract, web3 } = require('@openzeppelin/test-environment');
const { expectRevert, expectEvent, BN, time, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const _require = require('app-root-path').require;
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);
const {
  $AMPL,
  invokeRebase,
  checkAprox
} = _require('/test/helper');

const AmpleforthErc20 = contract.fromArtifact('UFragments');
const TokenGeyser = contract.fromArtifact('TokenGeyser');

const ONE_YEAR = 1 * 365 * 24 * 3600;
const START_BONUS = 50;
const BONUS_PERIOD = 86400;
const InitialSharesPerToken = 10 ** 6;

let ampl, dist, owner, anotherAccount;
async function setupContractAndAccounts () {
  const accounts = await chain.getUserAccounts();
  owner = web3.utils.toChecksumAddress(accounts[0]);
  anotherAccount = web3.utils.toChecksumAddress(accounts[8]);

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  dist = await TokenGeyser.new(ampl.address, ampl.address, 10, START_BONUS, BONUS_PERIOD,
    InitialSharesPerToken);
}

async function checkAvailableToUnlock (dist, v) {
  const u = await dist.totalUnlocked.call();
  const r = await dist.updateAccounting.call();
  await checkAprox(r[1].sub(u), v);
}

describe('LockedPool', function () {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts();
  });

  describe('getDistributionToken', function () {
    it('should return the staking token', async function () {
      expect(await dist.getDistributionToken.call()).to.equal(ampl.address);
    });
  });

  describe('lockTokens', function () {
    describe('when not approved', function () {
      it('should fail', async function () {
        const d = await TokenGeyser.new(ampl.address, ampl.address, 5, START_BONUS, BONUS_PERIOD, InitialSharesPerToken);
        await expectRevert.unspecified(d.lockTokens($AMPL(10), ONE_YEAR));
      });
    });

    describe('when number of unlock schedules exceeds the maxUnlockSchedules', function () {
      it('should fail', async function () {
        const d = await TokenGeyser.new(ampl.address, ampl.address, 5, START_BONUS, BONUS_PERIOD, InitialSharesPerToken);
        await ampl.approve(d.address, $AMPL(100));
        await d.lockTokens($AMPL(10), ONE_YEAR);
        await d.lockTokens($AMPL(10), ONE_YEAR);
        await d.lockTokens($AMPL(10), ONE_YEAR);
        await d.lockTokens($AMPL(10), ONE_YEAR);
        await d.lockTokens($AMPL(10), ONE_YEAR);
        await expectRevert(d.lockTokens($AMPL(10), ONE_YEAR),
          'TokenGeyser: reached maximum unlock schedules');
      });
    });

    describe('when totalLocked=0', function () {
      beforeEach(async function () {
        checkAprox(await dist.totalLocked.call(), 0);
        await ampl.approve(dist.address, $AMPL(100));
      });
      it('should updated the locked pool balance', async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100);
      });
      it('should create a schedule', async function () {
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        const s = await dist.unlockSchedules.call(0);
        expect(s[0]).to.be.bignumber.equal($AMPL(100));
        expect(s[1]).to.be.bignumber.equal($AMPL(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('1');
      });
      it('should log TokensLocked', async function () {
        const r = await dist.lockTokens($AMPL(100), ONE_YEAR);
        expectEvent(r, 'TokensLocked', {
          amount: $AMPL(100),
          total: $AMPL(100),
          durationSec: new BN(ONE_YEAR)
        });
      });
      it('should be protected', async function () {
        await ampl.approve(dist.address, $AMPL(100));
        await expectRevert(dist.lockTokens($AMPL(50), ONE_YEAR, { from: anotherAccount }),
          'Ownable: caller is not the owner');
        await dist.lockTokens($AMPL(50), ONE_YEAR);
      });
    });

    describe('when totalLocked>0', function () {
      let initialTime;
      beforeEach(async function () {
        await ampl.approve(dist.address, $AMPL(150));
        initialTime = await time.latest();
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100);
      });
      it('should updated the locked pool balance', async function () {
        await time.increaseTo(initialTime.add(new BN(ONE_YEAR / 10)))
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100 * 0.9 + 50);
      });
      it('should log TokensLocked', async function () {
        await time.increaseTo(initialTime.add(new BN(ONE_YEAR / 10)))
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        expectEvent(r, 'TokensLocked', {
          amount: $AMPL(50),
          total: $AMPL(100 * 0.9 + 50),
          durationSec: new BN(ONE_YEAR)
        });
      });
      it('should create a schedule', async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.call(1);
        expect(s[0]).to.be.bignumber.equal($AMPL(50));
        expect(s[1]).to.be.bignumber.equal($AMPL(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('2');
      });
    });

    describe('when totalLocked>0, rebase increases supply', function () {
      let initialTime;
      beforeEach(async function () {
        await ampl.approve(dist.address, $AMPL(150));
        initialTime = await time.latest();
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100);
        await invokeRebase(ampl, 100);
      });
      it('should updated the locked pool balance', async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 250);
      });
      it('should log TokensLocked', async function () {
        await time.increaseTo(initialTime.add(new BN(ONE_YEAR / 10)))
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        expectEvent(r, 'TokensLocked', {
          amount: $AMPL(50),
          total: $AMPL(50.0 + 200.0 * 0.9),
          durationSec: new BN(ONE_YEAR)
        });
      });
      it('should create a schedule', async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.call(1);
        expect(s[0]).to.be.bignumber.equal($AMPL(25));
        expect(s[1]).to.be.bignumber.equal($AMPL(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('2');
      });
    });

    describe('when totalLocked>0, rebase decreases supply', function () {
      let initialTime;
      beforeEach(async function () {
        await ampl.approve(dist.address, $AMPL(150));
        initialTime = await time.latest();
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100);
        await invokeRebase(ampl, -50);
      });
      it('should updated the locked pool balance', async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        checkAprox(await dist.totalLocked.call(), 100);
      });
      it('should log TokensLocked', async function () {
        await time.increaseTo(initialTime.add(new BN(ONE_YEAR / 10)))
        const r = await dist.lockTokens($AMPL(50), ONE_YEAR);
        expectEvent(r, 'TokensLocked', {
          amount: $AMPL(50),
          total: $AMPL(50 * 0.9 + 50),
          durationSec: new BN(ONE_YEAR)
        });
      });
      it('should create a schedule', async function () {
        await dist.lockTokens($AMPL(50), ONE_YEAR);
        const s = await dist.unlockSchedules.call(1);
        expect(s[0]).to.be.bignumber.equal($AMPL(100));
        expect(s[1]).to.be.bignumber.equal($AMPL(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('2');
      });
    });
  });

  describe('unlockTokens', function () {
    describe('single schedule', function () {
      describe('after waiting for 1/2 the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, $AMPL(100));
          await dist.lockTokens($AMPL(100), ONE_YEAR);
          await time.increase(ONE_YEAR / 2);
        });

        describe('when supply is unchanged', function () {
          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(100));
            await checkAvailableToUnlock(dist, 50);
          });
          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(100));
            expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($AMPL(0));
            await dist.updateAccounting();
            await checkAprox(dist.totalLocked.call(), 50);
            await checkAprox(dist.totalUnlocked.call(), 50);
            await checkAvailableToUnlock(dist, 0);
          });
          it('should log TokensUnlocked and update state', async function () {
            const r = await dist.updateAccounting();
            const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
            await checkAprox(l.args.amount, 50);
            await checkAprox(l.args.total, 50);
            const s = await dist.unlockSchedules(0);
            expect(s[0]).to.be.bignumber.equal($AMPL(100));
            await checkAprox(s[1], 50);
          });
        });

        describe('when rebase increases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, 100);
          });
          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(200));
            await checkAvailableToUnlock(dist, 100);
          });
          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(200));
            expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($AMPL(0));
            await dist.updateAccounting();
            await checkAprox(dist.totalLocked.call(), 100);
            await checkAprox(dist.totalUnlocked.call(), 100);
            await checkAvailableToUnlock(dist, 0);
          });
        });

        describe('when rebase decreases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, -50);
          });
          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(50));
            await checkAvailableToUnlock(dist, 25);
          });
          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(50));
            expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($AMPL(0));
            await dist.updateAccounting();
            await checkAprox(dist.totalLocked.call(), 25);
            await checkAprox(dist.totalUnlocked.call(), 25);
            await checkAvailableToUnlock(dist, 0);
          });
        });
      });

      describe('after waiting > the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, $AMPL(100));
          await dist.lockTokens($AMPL(100), ONE_YEAR);
          await time.increase(2 * ONE_YEAR);
        });
        it('should unlock all the tokens', async function () {
          await checkAvailableToUnlock(dist, 100);
        });
        it('should transfer tokens to unlocked pool', async function () {
          expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(100));
          expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($AMPL(0));
          await dist.updateAccounting();
          expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(0));
          await checkAprox(dist.totalUnlocked.call(), 100);
          await checkAvailableToUnlock(dist, 0);
        });
        it('should log TokensUnlocked and update state', async function () {
          const r = await dist.updateAccounting();
          const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
          await checkAprox(l.args.amount, 100);
          await checkAprox(l.args.total, 0);
          const s = await dist.unlockSchedules(0);
          expect(s[0]).to.be.bignumber.equal($AMPL(100));
          expect(s[1]).to.be.bignumber.equal($AMPL(100));
        });
      });

      describe('dust tokens due to division underflow', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, $AMPL(100));
          await dist.lockTokens($AMPL(1), 10 * ONE_YEAR);
        });
        it('should unlock all tokens', async function () {
          // 1 AMPL locked for 10 years. Almost all time passes upto the last minute.
          // 0.999999809 AMPLs are unlocked.
          // 1 minute passes, Now: all of the rest are unlocked: 191
          // before (#24): only 190 would have been unlocked and 0.000000001 AMPL would be
          // locked.
          await time.increase(10 * ONE_YEAR - 60);
          const r1 = await dist.updateAccounting();
          const l1 = r1.logs.filter(l => l.event === 'TokensUnlocked')[0];
          await time.increase(65);
          const r2 = await dist.updateAccounting();
          const l2 = r2.logs.filter(l => l.event === 'TokensUnlocked')[0];
          expect(l1.args.amount.add(l2.args.amount)).to.be.bignumber.equal($AMPL(1));
        });
      });
    });

    describe('multi schedule', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, $AMPL(200));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        await time.increaseTo((await time.latest()).add(new BN(ONE_YEAR / 2)));
        await dist.lockTokens($AMPL(100), ONE_YEAR);
        await time.increaseTo((await time.latest()).add(new BN(ONE_YEAR / 10)));
      });
      it('should return the remaining unlock value', async function () {
        await checkAvailableToUnlock(dist, 20);
      });
      it('should transfer tokens to unlocked pool', async function () {
        expect(await dist.totalLocked.call()).to.be.bignumber.equal($AMPL(150));
        expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($AMPL(50));
        await dist.updateAccounting();
        await checkAprox(dist.totalLocked.call(), 130);
        await checkAprox(dist.totalUnlocked.call(), 70);
        await checkAvailableToUnlock(dist, 0);
      });
      it('should log TokensUnlocked and update state', async function () {
        const r = await dist.updateAccounting();
        const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
        await checkAprox(l.args.amount, 20);
        await checkAprox(l.args.total, 130);
        const s1 = await dist.unlockSchedules(0);
        expect(s1[0]).to.be.bignumber.equal($AMPL(100));
        await checkAprox(s1[1], 60);
        const s2 = await dist.unlockSchedules(1);
        expect(s2[0]).to.be.bignumber.equal($AMPL(100));
        await checkAprox(s2[1], 10);
      });
      it('should continue linear the unlock', async function () {
        await dist.updateAccounting();
        await time.increase(ONE_YEAR / 5);
        await dist.updateAccounting();
        await checkAprox(dist.totalLocked.call(), 90);
        await checkAprox(dist.totalUnlocked.call(), 110);
        await checkAvailableToUnlock(dist, 0);
        await time.increase(ONE_YEAR / 5);
        await dist.updateAccounting();
        await checkAprox(dist.totalLocked.call(), 50);
        await checkAprox(dist.totalUnlocked.call(), 150);
        await checkAvailableToUnlock(dist, 0);
      });
    });
  });

  describe('updateAccounting', function () {
    let _r, _t;
    beforeEach(async function () {
      _r = await dist.updateAccounting.call({ from: owner });
      _t = await time.latest();
      await ampl.approve(dist.address, $AMPL(300));
      await dist.stake($AMPL(100), []);
      await dist.lockTokens($AMPL(100), ONE_YEAR);
      await time.increase(ONE_YEAR / 2);
      await dist.lockTokens($AMPL(100), ONE_YEAR);
      await time.increase(ONE_YEAR / 10);
    });

    describe('when user history does exist', async function () {
      it('should return the system state', async function () {
        const r = await dist.updateAccounting.call({ from: owner });
        const t = await time.latest();
        await checkAprox(r[0], 130);
        await checkAprox(r[1], 70);
        const timeElapsed = t.sub(_t);
        expect(r[2].div(new BN(100e9).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        expect(r[3].div(new BN(100e9).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        await checkAprox(r[4], 70);
        await checkAprox(r[4], 70);
        const delta = new BN(r[5]).sub(new BN(_r[5]));
        expect(delta).to.be
          .bignumber.above(timeElapsed.sub(new BN(1))).and
          .bignumber.below(timeElapsed.add(new BN(1)));
      });
    });

    describe('when user history does not exist', async function () {
      it('should return the system state', async function () {
        const r = await dist.updateAccounting.call({ from: constants.ZERO_ADDRESS });
        const t = await time.latest();
        await checkAprox(r[0], 130);
        await checkAprox(r[1], 70);
        const timeElapsed = t.sub(_t);
        expect(r[2].div(new BN(100e9).mul(new BN(InitialSharesPerToken)))).to.be.bignumber.equal('0');
        expect(r[3].div(new BN(100e9).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        await checkAprox(r[4], 0);
        const delta = new BN(r[5]).sub(new BN(_r[5]));
        expect(delta).to.be
          .bignumber.above(timeElapsed.sub(new BN(1))).and
          .bignumber.below(timeElapsed.add(new BN(1)));
      });
    });
  });
});
