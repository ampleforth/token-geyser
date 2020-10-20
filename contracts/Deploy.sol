pragma solidity 0.5.0;

import "./TokenGeyser.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

contract Deploy {
	TokenGeyser private tokenGeyser;

	constructor(address staking, address reword, uint256 maxUnlockSchedules, uint256 startBonus, uint256 bonusPeriodSec, uint256 initialSharesPerToken) public {
		IERC20 idev = IERC20(staking);
		IERC20 iuniv2 = IERC20(reword);
		tokenGeyser = new TokenGeyser(idev, iuniv2, maxUnlockSchedules, startBonus, bonusPeriodSec, initialSharesPerToken);
		tokenGeyser.transferOwnership(msg.sender);
	}

	function getTokenGeyserAddress() external view returns (address) {
		return address(tokenGeyser);
	}
}
