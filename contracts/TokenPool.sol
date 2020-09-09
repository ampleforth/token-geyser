pragma solidity 0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title A simple holder of tokens.
 * This is a simple contract to hold tokens. It's useful in the case where a separate contract
 * needs to hold multiple distinct pools of the same token.
 */
contract TokenPool is Ownable {
    IERC20 public token;

    constructor(IERC20 _token) public {
        token = _token;
    }

    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function transfer(address to, uint256 value) external onlyOwner returns (bool) {
        return token.transfer(to, value);
    }

    function rescueFunds(address tokenToRescue, address to, uint256 amount) external onlyOwner returns (bool) {
        require(address(token) != tokenToRescue, 'TokenPool: Cannot claim token held by the contract');

        return IERC20(tokenToRescue).transfer(to, amount);
    }
}
