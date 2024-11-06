pragma solidity ^0.8.24;

/**
 * @title Staking interface, as defined by EIP-900.
 * @dev https://github.com/ethereum/EIPs/blob/master/EIPS/eip-900.md
 */
interface IStaking {
    function stake(uint256 amount, bytes calldata data) external;
    function stakeFor(address user, uint256 amount, bytes calldata) external;
    function unstake(uint256 amount, bytes calldata) external;
    function totalStakedFor(address addr) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function token() external view returns (address);
    function supportsHistory() external view returns (bool);
}
