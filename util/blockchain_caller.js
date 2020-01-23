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
    this.web3.currentProvider.send(this.rpcmsg(method, params), function (e, r) {
      if (e) reject(e);
      resolve(r);
    });
  });
};

BlockchainCaller.prototype.getUserAccounts = async function () {
  const accounts = await this.sendRawToBlockchain('eth_accounts');
  return accounts.result;
};

module.exports = BlockchainCaller;
