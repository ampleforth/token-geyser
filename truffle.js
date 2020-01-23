const connectionConfig = require('frg-ethereum-runners/config/network_config.json');

module.exports = {
  networks: {
    ganacheUnitTest: connectionConfig.ganacheUnitTest,
    gethUnitTest: connectionConfig.gethUnitTest,
    testrpcCoverage: connectionConfig.testrpcCoverage
  },
  mocha: {
    enableTimeouts: false,
    reporter: 'eth-gas-reporter',
    reporterOptions: {
      currency: 'USD'
    }
  },
  compilers: {
    solc: {
      version: '0.5.0'
    }
  },
};
