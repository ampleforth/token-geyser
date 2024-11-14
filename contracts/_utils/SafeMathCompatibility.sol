// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// NOTE: Adding an intermediate library to support older version of safemath.
library SafeMathCompatibility {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a - b;
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        return a * b;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        // solhint-disable-next-line custom-errors
        require(b > 0, "SafeMath: division by zero");
        return a / b;
    }

    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        // solhint-disable-next-line custom-errors
        require(b > 0, "SafeMath: modulo by zero");
        return a % b;
    }
}
