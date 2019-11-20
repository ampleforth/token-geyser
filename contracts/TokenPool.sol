pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title A simple holder of tokens.
 * This is a simple contract to hold tokens. It's useful in the case where a separate contract
 * needs to hold multiple distinct pools of the same token.
 */
contract TokenPool is Ownable {
    IERC20 _token;

    constructor(IERC20 token) public {
        _token = token;
    }

    function getToken() public view returns (IERC20) {
        return _token;
    }

    function balance() public view returns (uint256) {
        return _token.balanceOf(address(this));
    }

    function transfer(address to, uint256 value) external onlyOwner returns (bool) {
        return _token.transfer(to, value);
    }
}
