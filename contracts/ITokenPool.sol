// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Token pool interface
 */
interface ITokenPool {
    function init(IERC20 token_) external;
    function token() external view returns (IERC20);
    function balance() external view returns (uint256);
    function transfer(address to, uint256 value) external;
    function rescueFunds(address tokenToRescue, address to, uint256 amount) external;
}
