// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ITokenPool } from "./ITokenPool.sol";

/**
 * @title A simple holder of tokens.
 * This is a simple contract to hold tokens. It's useful in the case where a separate contract
 * needs to hold multiple distinct pools of the same token.
 */
contract TokenPool is ITokenPool, OwnableUpgradeable {
    using SafeERC20 for IERC20;
    IERC20 public token;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(IERC20 token_) public initializer {
        __Ownable_init(msg.sender);
        token = token_;
    }

    function balance() public view override returns (uint256) {
        return token.balanceOf(address(this));
    }

    function transfer(address to, uint256 value) external override onlyOwner {
        token.safeTransfer(to, value);
    }

    function rescueFunds(
        address tokenToRescue,
        address to,
        uint256 amount
    ) external override onlyOwner {
        require(
            address(token) != tokenToRescue,
            "TokenPool: Cannot claim token held by the contract"
        );

        IERC20(tokenToRescue).safeTransfer(to, amount);
    }
}
