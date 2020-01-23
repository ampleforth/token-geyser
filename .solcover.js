module.exports = {
  norpc: true,
  testCommand: 'npm test',
  compileCommand: 'npm run compile-contracts',
  copyPackages: ['openzeppelin-eth', 'openzeppelin-solidity', 'uFragments'],
  skipFiles: ['IStaking.sol'],
};
