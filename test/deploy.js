const { contract } = require('@openzeppelin/test-environment');
const { expect } = require('chai');

const MockERC20 = contract.fromArtifact('MockERC20');
const Deploy = contract.fromArtifact('Deploy');
const TokenGeyser = contract.fromArtifact('TokenGeyser');

describe('deploy', function () {
  describe('getTokenGeyserAddress', function () {
    it('generate TokenGeyser contract', async function () {
      const stakedToken = await MockERC20.new(1000);
      const rewordToken = await MockERC20.new(1000);
      const deploy = await Deploy.new(stakedToken.address, rewordToken.address, 100, 0, 2592000, 1);
      const tokenGeyserAddress = await deploy.getTokenGeyserAddress.call();
      const tokenGeyser = await TokenGeyser.at(tokenGeyserAddress);
      expect(await tokenGeyser.startBonus.call()).to.be.bignumber.equal('0');
      expect(await tokenGeyser.bonusPeriodSec.call()).to.be.bignumber.equal('2592000');
    });
  });
});
