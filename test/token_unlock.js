const BigNumber = web3.BigNumber;
require('chai').use(require('chai-bignumber')(BigNumber)).should();

const _require = require('app-root-path').require;
const { checkAproxBal, toAmplDecimalsStr, invokeRebase } = _require('/test/helper');
const BlockchainCaller = _require('/util/blockchain_caller');
const chain = new BlockchainCaller(web3);

const AmpleforthErc20 = artifacts.require('uFragments/UFragments.sol');
const ContVestTokenDist = artifacts.require('ContVestTokenDist.sol');

const ONE_YEAR = 1 * 365 * 24 * 3600;

let ampl, dist, owner, anotherAccount, r;
async function setupContractAndAccounts (accounts) {
  owner = accounts[0];
  anotherAccount = accounts[8];

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  dist = await ContVestTokenDist.new(ampl.address, ampl.address, 10);
}

contract('LockedPool', function (accounts) {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts(accounts);
  });

  describe('lockTokens', function () {
    describe('when number of unlock schedules exceeds the maxUnlockSchedules', function () {
      it('should fail', async function () {
        const d = await ContVestTokenDist.new(ampl.address, ampl.address, 5);
        await ampl.approve(d.address, toAmplDecimalsStr(100));
        await d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR);
        await d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR);
        await d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR);
        await d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR);
        await d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR);
        expect(await chain.isEthException(
          d.lockTokens(toAmplDecimalsStr(10), ONE_YEAR)
        )).to.be.true;
      });
    });

    describe('when totalLocked=0', function () {
      beforeEach(async function () {
        (await dist.totalLocked.call()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await ampl.approve(dist.address, toAmplDecimalsStr(100));
        r = await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        (await dist.totalLocked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(0);
        (s[0]).should.be.bignumber.eq(toAmplDecimalsStr(100));
        (s[3]).should.be.bignumber.eq(ONE_YEAR);
        (s[1].plus(s[3])).should.be.bignumber.eq(s[2]);
      });
      it('should log TokensLocked', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('TokensLocked');
        await checkAproxBal(l.args.amount, 100);
        await checkAproxBal(l.args.total, 100);
        (l.args.durationSec).should.be.bignumber.eq(ONE_YEAR);
      });
      it('should be protected', async function () {
        await ampl.approve(dist.address, toAmplDecimalsStr(100));
        expect(await chain.isEthException(
          dist.lockTokens(toAmplDecimalsStr(50), ONE_YEAR, {
            from: anotherAccount
          })
        )).to.be.true;
        expect(await chain.isEthException(
          dist.lockTokens(toAmplDecimalsStr(50, ONE_YEAR))
        )).not.to.be.true;
      });
    });

    describe('when totalLocked>0', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        (await dist.totalLocked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        r = await dist.lockTokens(toAmplDecimalsStr(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 150);
      });
      it('should log TokensLocked', async function () {
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('TokensLocked');
        await checkAproxBal(l.args.amount, 50);
        await checkAproxBal(l.args.total, 150);
        (l.args.durationSec).should.be.bignumber.eq(ONE_YEAR);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        (s[0]).should.be.bignumber.eq(toAmplDecimalsStr(50));
        (s[3]).should.be.bignumber.eq(ONE_YEAR);
        (s[1].plus(s[3])).should.be.bignumber.eq(s[2]);
      });
    });

    describe('when totalLocked>0, rebase increases supply', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        (await dist.totalLocked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        await invokeRebase(ampl, 100);
        r = await dist.lockTokens(toAmplDecimalsStr(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 250);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        (s[0]).should.be.bignumber.eq(toAmplDecimalsStr(25));
        (s[3]).should.be.bignumber.eq(ONE_YEAR);
        (s[1].plus(s[3])).should.be.bignumber.eq(s[2]);
      });
    });

    describe('when totalLocked>0, rebase decreases supply', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimalsStr(150));
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        (await dist.totalLocked.call()).should.be.bignumber.eq(toAmplDecimalsStr(100));
        await invokeRebase(ampl, -50);
        r = await dist.lockTokens(toAmplDecimalsStr(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 100);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        (s[0]).should.be.bignumber.eq(toAmplDecimalsStr(100));
        (s[3]).should.be.bignumber.eq(ONE_YEAR);
        (s[1].plus(s[3])).should.be.bignumber.eq(s[2]);
      });
    });
  });

  describe('unlockTokens', function () {
    describe('single schedule', function () {
      describe('after waiting for 1/2 the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, toAmplDecimalsStr(100));
          await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
          await chain.waitForSomeTime(ONE_YEAR / 2);
        });

        describe('when supply is unchanged', function () {
          it('should unlock 1/2 the tokens', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(100));
            await checkAproxBal(dist.unlockTokens.call(), 50);
          });
          it('should transfer tokens to unlocked pool', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(100));
            (await dist.totalUnlocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
            await dist.unlockTokens();
            await checkAproxBal(dist.totalLocked.call(), 50);
            await checkAproxBal(dist.totalUnlocked.call(), 50);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
          it('should log TokensUnlocked', async function () {
            r = await dist.unlockTokens();
            const l = r.logs[r.logs.length - 1];
            expect(l.event).to.eql('TokensUnlocked');
            await checkAproxBal(l.args.amount, 50);
            await checkAproxBal(l.args.total, 50);
          });
        });

        describe('when rebase increases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, 100);
          });
          it('should unlock 1/2 the tokens', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(200));
            await checkAproxBal(dist.unlockTokens.call(), 100);
          });
          it('should transfer tokens to unlocked pool', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(200));
            (await dist.totalUnlocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
            await dist.unlockTokens();
            await checkAproxBal(dist.totalLocked.call(), 100);
            await checkAproxBal(dist.totalUnlocked.call(), 100);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
        });

        describe('when rebase decreases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, -50);
          });
          it('should unlock 1/2 the tokens', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(50));
            await checkAproxBal(dist.unlockTokens.call(), 25);
          });
          it('should transfer tokens to unlocked pool', async function () {
            (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(50));
            (await dist.totalUnlocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
            await dist.unlockTokens();
            await checkAproxBal(dist.totalLocked.call(), 25);
            await checkAproxBal(dist.totalUnlocked.call(), 25);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
        });
      });

      describe('after waiting > the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, toAmplDecimalsStr(100));
          await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
          await chain.waitForSomeTime(2 * ONE_YEAR);
        });
        it('should unlock all the tokens', async function () {
          await checkAproxBal(dist.unlockTokens.call(), 100);
        });
        it('should transfer tokens to unlocked pool', async function () {
          (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(100));
          (await dist.totalUnlocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
          await dist.unlockTokens();
          (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
          await checkAproxBal(dist.totalUnlocked.call(), 100);
          await checkAproxBal(dist.unlockTokens.call(), 0);
        });
        it('should log TokensUnlocked', async function () {
          r = await dist.unlockTokens();
          const l = r.logs[r.logs.length - 1];
          expect(l.event).to.eql('TokensUnlocked');
          await checkAproxBal(l.args.amount, 100);
          await checkAproxBal(l.args.total, 0);
        });
      });
    });

    describe('multi schedule', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimalsStr(200));
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await chain.waitForSomeTime(ONE_YEAR / 2);
        await dist.lockTokens(toAmplDecimalsStr(100), ONE_YEAR);
        await chain.waitForSomeTime(ONE_YEAR / 10);
      });
      it('should return the total unlock value', async function () {
        await checkAproxBal(dist.unlockTokens.call(), 70);
      });
      it('should transfer tokens to unlocked pool', async function () {
        (await dist.totalLocked()).should.be.bignumber.eq(toAmplDecimalsStr(200));
        (await dist.totalUnlocked()).should.be.bignumber.eq(toAmplDecimalsStr(0));
        await dist.unlockTokens();
        await checkAproxBal(dist.totalLocked.call(), 130);
        await checkAproxBal(dist.totalUnlocked.call(), 70);
        await checkAproxBal(dist.unlockTokens.call(), 0);
      });
      it('should log TokensUnlocked', async function () {
        r = await dist.unlockTokens();
        const l = r.logs[r.logs.length - 1];
        expect(l.event).to.eql('TokensUnlocked');
        await checkAproxBal(l.args.amount, 70);
        await checkAproxBal(l.args.total, 130);
      });
      it('should continue linear the unlock', async function () {
        await dist.unlockTokens();
        await chain.waitForSomeTime(ONE_YEAR / 5);
        await dist.unlockTokens();
        await checkAproxBal(dist.totalLocked.call(), 90);
        await checkAproxBal(dist.totalUnlocked.call(), 110);
        await checkAproxBal(dist.unlockTokens.call(), 0);
        await chain.waitForSomeTime(ONE_YEAR / 5);
        await dist.unlockTokens();
        await checkAproxBal(dist.totalLocked.call(), 50);
        await checkAproxBal(dist.totalUnlocked.call(), 150);
        await checkAproxBal(dist.unlockTokens.call(), 0);
      });
    });
  });
});
