// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Geyser staking interface
 */
interface ITokenGeyser {
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external returns (uint256);
    function totalStakedBy(address addr) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function totalLocked() external view returns (uint256);
    function totalUnlocked() external view returns (uint256);
    function stakingToken() external view returns (IERC20);
    function distributionToken() external view returns (IERC20);
}
