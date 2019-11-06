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

let ampl, dist, owner, anotherAccount, r;
async function setupContractAndAccounts (accounts) {
  owner = accounts[0];
  anotherAccount = accounts[8];

  ampl = await AmpleforthErc20.new();
  await ampl.initialize(owner);
  await ampl.setMonetaryPolicy(owner);

  dist = await ContVestTokenDist.new(ampl.address, ampl.address);
}

async function checkAproxBal (x, y) {
  const delta = toAmplDecimals(1).div(new BN(100));
  expect(await x).to.gt.BN(toAmplDecimals(y).sub(delta));
  expect(await x).to.lt.BN(toAmplDecimals(y).add(delta));
}

contract('LockedPool', function (accounts) {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts(accounts);
  });

  describe('lockTokens', function () {
    describe('when totalLocked=0', function () {
      beforeEach(async function () {
        expect(await dist.totalLocked.call()).to.eq.BN(toAmplDecimals(0));
        await ampl.approve(dist.address, toAmplDecimals(100));
        r = await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        expect(await dist.totalLocked.call()).to.eq.BN(toAmplDecimals(100));
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(0);
        expect(s.initialLockedShares).to.eq.BN(toAmplDecimals(100));
        expect(s.durationSec).to.eq.BN(ONE_YEAR);
        expect(s.lastUnlockTimestampSec.add(s.durationSec)).to.eq.BN(s.endAtSec);
      });
      it('should log TokensLocked', async function () {
        const l = r.logs[r.logs.length - 1].args;
        expect(l.amount).to.eq.BN(toAmplDecimals(100));
        expect(l.durationSec).to.eq.BN(ONE_YEAR);
      });
      it('should be protected', async function () {
        await ampl.approve(dist.address, toAmplDecimals(100));
        expect(await chain.isEthException(
          dist.lockTokens(toAmplDecimals(50), ONE_YEAR, {
            from: anotherAccount
          })
        )).to.be.true;
        expect(await chain.isEthException(
          dist.lockTokens(toAmplDecimals(50, ONE_YEAR))
        )).not.to.be.true;
      });
    });

    describe('when totalLocked>0', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimals(150));
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        expect(await dist.totalLocked.call()).to.eq.BN(toAmplDecimals(100));
        r = await dist.lockTokens(toAmplDecimals(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 150);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        expect(s.initialLockedShares).to.eq.BN(toAmplDecimals(50));
        expect(s.durationSec).to.eq.BN(ONE_YEAR);
        expect(s.lastUnlockTimestampSec.add(s.durationSec)).to.eq.BN(s.endAtSec);
      });
    });

    describe('when totalLocked>0, rebase increases supply', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimals(150));
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        expect(await dist.totalLocked.call()).to.eq.BN(toAmplDecimals(100));
        await invokeRebase(ampl, 100);
        r = await dist.lockTokens(toAmplDecimals(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 250);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        expect(s.initialLockedShares).to.eq.BN(toAmplDecimals(25));
        expect(s.durationSec).to.eq.BN(ONE_YEAR);
        expect(s.lastUnlockTimestampSec.add(s.durationSec)).to.eq.BN(s.endAtSec);
      });
    });

    describe('when totalLocked>0, rebase decreases supply', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimals(150));
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        expect(await dist.totalLocked.call()).to.eq.BN(toAmplDecimals(100));
        await invokeRebase(ampl, -50);
        r = await dist.lockTokens(toAmplDecimals(50), ONE_YEAR);
      });
      it('should updated the locked pool balance', async function () {
        await checkAproxBal(dist.totalLocked.call(), 100);
      });
      it('should create a schedule', async function () {
        const s = await dist.unlockSchedules.call(1);
        expect(s.initialLockedShares).to.eq.BN(toAmplDecimals(100));
        expect(s.durationSec).to.eq.BN(ONE_YEAR);
        expect(s.lastUnlockTimestampSec.add(s.durationSec)).to.eq.BN(s.endAtSec);
      });
    });
  });

  describe('unlock', function () {
    describe('single schedule', function () {
      describe('after waiting for 1/2 the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, toAmplDecimals(100));
          await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
          await chain.waitForSomeTime(ONE_YEAR / 2);
        });

        describe('when supply is unchanged', function () {
          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(100));
            await checkAproxBal(dist.unlockTokens.call(), 50);
          });

          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(100));
            expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
            await dist.unlockTokens();
            await checkAproxBal(dist.totalLocked.call(), 50);
            await checkAproxBal(dist.totalUnlocked.call(), 50);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });

          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(100));
            expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
            await dist.unlockSchedule(0);
            await checkAproxBal(dist.totalLocked.call(), 50);
            await checkAproxBal(dist.totalUnlocked.call(), 50);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
        });

        describe('when rebase increases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, 100);
          });

          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(200));
            await checkAproxBal(dist.unlockTokens.call(), 100);
          });

          describe('unlockTokens', function () {
            it('should transfer tokens to unlocked pool', async function () {
              expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(200));
              expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
              await dist.unlockTokens();
              await checkAproxBal(dist.totalLocked.call(), 100);
              await checkAproxBal(dist.totalUnlocked.call(), 100);
              await checkAproxBal(dist.unlockTokens.call(), 0);
            });
          });

          describe('unlockSchedule', function () {
            it('should transfer tokens to unlocked pool', async function () {
              expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(200));
              expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
              await dist.unlockSchedule(0);
              await checkAproxBal(dist.totalLocked.call(), 100);
              await checkAproxBal(dist.totalUnlocked.call(), 100);
              await checkAproxBal(dist.unlockTokens.call(), 0);
            });
          });
        });

        describe('when rebase decreases supply', function () {
          beforeEach(async function () {
            await invokeRebase(ampl, -50);
          });

          it('should unlock 1/2 the tokens', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(50));
            await checkAproxBal(dist.unlockTokens.call(), 25);
          });

          describe('unlockTokens', function () {
            it('should transfer tokens to unlocked pool', async function () {
              expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(50));
              expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
              await dist.unlockTokens();
              await checkAproxBal(dist.totalLocked.call(), 25);
              await checkAproxBal(dist.totalUnlocked.call(), 25);
              await checkAproxBal(dist.unlockTokens.call(), 0);
            });
          });

          describe('unlockSchedule', function () {
            it('should transfer tokens to unlocked pool', async function () {
              expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(50));
              expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
              await dist.unlockSchedule(0);
              await checkAproxBal(dist.totalLocked.call(), 25);
              await checkAproxBal(dist.totalUnlocked.call(), 25);
              await checkAproxBal(dist.unlockTokens.call(), 0);
            });
          });
        });
      });

      describe('after waiting > the duration', function () {
        beforeEach(async function () {
          await ampl.approve(dist.address, toAmplDecimals(100));
          await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
          await chain.waitForSomeTime(2 * ONE_YEAR);
        });

        it('should unlock all the tokens', async function () {
          await checkAproxBal(dist.unlockTokens.call(), 100);
        });

        describe('unlockTokens', function () {
          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(100));
            expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
            await dist.unlockTokens();
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(0));
            await checkAproxBal(dist.totalUnlocked.call(), 100);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
        });

        describe('unlockSchedule', function () {
          it('should transfer tokens to unlocked pool', async function () {
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(100));
            expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
            await dist.unlockSchedule(0);
            expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(0));
            await checkAproxBal(dist.totalUnlocked.call(), 100);
            await checkAproxBal(dist.unlockTokens.call(), 0);
          });
        });
      });
    });

    describe('multi schedule', function () {
      beforeEach(async function () {
        await ampl.approve(dist.address, toAmplDecimals(200));
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await chain.waitForSomeTime(ONE_YEAR / 2);
        await dist.lockTokens(toAmplDecimals(100), ONE_YEAR);
        await chain.waitForSomeTime(ONE_YEAR / 10);
      });

      it('should return the total unlock value', async function () {
        await checkAproxBal(dist.unlockTokens.call(), 70);
      });

      describe('unlockTokens', function () {
        it('should transfer tokens to unlocked pool', async function () {
          expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(200));
          expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
          await dist.unlockTokens();
          await checkAproxBal(dist.totalLocked.call(), 130);
          await checkAproxBal(dist.totalUnlocked.call(), 70);
          await checkAproxBal(dist.unlockTokens.call(), 0);
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

      describe('unlockSchedule', function () {
        it('should transfer tokens to unlocked pool', async function () {
          expect(await dist.totalLocked()).to.eq.BN(toAmplDecimals(200));
          expect(await dist.totalUnlocked()).to.eq.BN(toAmplDecimals(0));
          await dist.unlockSchedule(0);
          await checkAproxBal(dist.totalLocked.call(), 140);
          await checkAproxBal(dist.totalUnlocked.call(), 60);
          await checkAproxBal(dist.unlockTokens.call(), 10);
          await dist.unlockSchedule(1);
          await checkAproxBal(dist.totalLocked.call(), 130);
          await checkAproxBal(dist.totalUnlocked.call(), 70);
          await checkAproxBal(dist.unlockTokens.call(), 0);
        });
      });
    });
  });
});
