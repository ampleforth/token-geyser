pragma solidity 0.4.24;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract TokenPool is Ownable {
    address _token;

    // TODO: setup owner
    constructor(address token) public {
        _token = token;
    }

    function getToken() public view returns (address) {
        return _token;
    }

    function balance() public view returns (uint256) {
        return _token.balanceOf(this);
    }

    function transfer(address to, uint256 value) external onlyOwner returns (bool) {
        return _token.transfer(to, value);
    }
}
