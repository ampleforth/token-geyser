import { HardhatUserConfig } from "hardhat/config";
import { Wallet } from "ethers";

import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import "hardhat-gas-reporter";

// Loads custom tasks
// import "./tasks/deploy";

// Loads env variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

export default {
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0,
      accounts: {
        mnemonic: Wallet.createRandom().mnemonic.phrase,
      },
    },
    ganache: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_SECRET}`,
      accounts: {
        mnemonic: process.env.PROD_MNEMONIC || Wallet.createRandom().mnemonic.phrase,
      },
      gasMultiplier: 1.01,
    },
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_SECRET}`,
      accounts: {
        mnemonic: process.env.PROD_MNEMONIC || Wallet.createRandom().mnemonic.phrase,
      },
      gasMultiplier: 1.005,
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 750,
          },
        },
      },
      {
        version: "0.8.3",
      },
      {
        version: "0.8.4",
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 750,
          },
        },
      },
    ],
  },
  gasReporter: {
    currency: "USD",
    enabled: !!process.env.REPORT_GAS,
    excludeContracts: ["_test/"],
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    L1Etherscan: process.env.ETHERSCAN_API_KEY,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  mocha: {
    bail: false,
    timeout: 100000000,
  },
} as HardhatUserConfig;
