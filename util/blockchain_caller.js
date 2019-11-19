// A wrapper on top of web3 to help interact with an underlying blockchain
// This is where blockchain specific interaction logic goes
class BlockchainCaller {
  constructor (web3) {
    this._web3 = web3;
  }
  get web3 () {
    return this._web3;
  }
  rpcmsg (method, params = []) {
    return {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: new Date().getTime()
    };
  }
}

BlockchainCaller.prototype.sendRawToBlockchain = function (method, params) {
  return new Promise((resolve, reject) => {
    this.web3.currentProvider.sendAsync(this.rpcmsg(method, params), function (e, r) {
      if (e) reject(e);
      resolve(r);
    });
  });
};

BlockchainCaller.prototype.waitForNBlocks = async function (n) {
  for (let i = 0; i < n; i++) {
    await this.sendRawToBlockchain('evm_mine');
  }
};

BlockchainCaller.prototype.waitForSomeTime = async function (durationInSec) {
  await this.sendRawToBlockchain('evm_increaseTime', [durationInSec]);
  await this.sendRawToBlockchain('evm_mine');
};

BlockchainCaller.prototype.getUserAccounts = async function () {
  const accounts = await this.sendRawToBlockchain('eth_accounts');
  return accounts.result;
};

BlockchainCaller.prototype.getBlockHeight = async function () {
  const block = await this.web3.eth.getBlock('latest');
  return block.number;
};

BlockchainCaller.prototype.getBlockGasLimit = async function () {
  const block = await this.web3.eth.getBlock('latest');
  return block.gasLimit;
};

BlockchainCaller.prototype.currentTime = async function () {
  const block = await this.sendRawToBlockchain('eth_getBlockByNumber', ['latest', false]);
  return parseInt(block.result.timestamp);
};

BlockchainCaller.prototype.getTransactionMetrics = async function (hash) {
  const txR = await this.web3.eth.getTransactionReceipt(hash);
  const tx = await this.web3.eth.getTransaction(hash);
  return {
    gasUsed: txR.gasUsed,
    gasPrice: tx.gasPrice,
    byteCodeSize: (tx.input.length * 4 / 8)
  };
};

/*
  Inspired loosely by Openzeppelin's assertRevert.
  https://github.com/OpenZeppelin/openzeppelin-solidity/blob/master/test/helpers/assertRevert.js
*/
BlockchainCaller.prototype.isEthException = async function (promise) {
  let msg = 'No Exception';
  try {
    await promise;
  } catch (e) {
    msg = e.message;
  }
  return (
    msg.includes('VM Exception while processing transaction: revert') ||
    msg.includes('invalid opcode') ||
    msg.includes('exited with an error (status 0)')
  );
};

// Parse compound-specific error codes
BlockchainCaller.prototype.isCompoundException = async function (promise) {
  const tx = await promise;
  const errors = tx.logs.filter(l => l.event === 'Failure');
  return errors.length > 0;
};

module.exports = BlockchainCaller;
