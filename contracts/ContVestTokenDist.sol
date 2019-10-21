pragma solidity 0.4.24;

// TODO:
// - Add LockedTokens
// - Add ERC20 functionality for CVTD tokens

//import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

import "IStaking.sol";
import "TokenPool.sol";

/**
 *
 */
contract ContVestTokenDist is IStaking {
    event TokensUnlocked(uint256 stage, uint256 numTokens);
    event Staked(address indexed user, uint256 amount, uint256 total, bytes data);
    event Unstaked(address indexed user, uint256 amount, uint256 total, bytes data);


    TokenPool private _stakingPool;
    TokenPool private _unlockedPool;
    TokenPool private _lockedPool;

    uint256 private _totalStakingShares = 0;
    uint256 private _totalStakingShareSeconds = 0;
    uint256 private _lastAccountingTimestampSec = 0;

    struct Stake {
        uint256 stakingShares;
        uint256 timestampSec;
    }

    struct UserAccount {
        uint256 stakingShares;  // TODO: needed?
        uint256 stakingShareSeconds;  // TODO: needed?
        uint256 lastAccountingTimestampSec;  // TODO: needed?
        Stake[] stakes;
    }

    mapping(address => UserAccount) private _userAccounts;

    constructor(address stakingToken, address distributionToken) public {
        _stakingPool = new TokenPool(stakingToken);
        _unlockedPool = new TokenPool(distributionToken);
        _lockedPool = new TokenPool(distributionToken);

        assert(_stakingPool.owner() == this);
        assert(_unlockedPool.owner() == this);
        assert(_lockedPool.owner() == this);
    }

    // Pool info
    function getStakingToken() public view returns (address) {
        return _stakingPool.getToken();
    }

    function getDistributionToken() public view returns (address) {
        // assert(_unlockedPool.getToken() == _lockedPool.getToken());
        return _unlockedPool.getToken();
    }

    function getUnlockedPoolSize() public view returns (uint256) {
        return _unlockedPool.balance();
    }

    function getLockedPoolSize() public view returns (uint256) {
        return _lockedPool.balance();
    }

    // Staking
    function stake(uint256 amount, bytes data) external {
        return stakeFor(msg.sender, amount, data);
    }

    function stakeFor(address user, uint256 amount, bytes data) external {
        updateAccounting();

        // 1. User Accounting
        // TODO: If we start with 1 share = 1 token, will we hit rounding errors in the future?
        mintedStakingShares = (totalStaked() > 0)
            ? _totalStakingShares.mul(amount).div(totalStaked())
            : amount;

        UserAccount memory account = _userAccounts[user];
        account.stakingShares = user.stakingShares.add(mintedStakingShares);
        account.lastAccountingTimestamp = now;

        Stake memory newStake = Stake(mintedStakingShares, now);
        account.stakes.push(newStake);
        _userAccounts[user] = account;

        // 2. Global Accounting
        _totalStakingShares = _totalStakingShares.add(mintedStakingShares);
        // Already set in updateAccounting()
        // _lastAccountingTimestampSec = now;

        // interactions
        require(_stakingPool.getToken().transferFrom(user, _stakingPool, amount));

        emit Staked(user, amount, totalStakedFor(user), data);
    }

    function unstake(uint256 amount, bytes data) external {
        updateAccounting();

        // checks
        require(amount > 0);
        uint256 userStakedAmpl = _totalStakedFor(msg.sender);
        require(userStakedAmpl >= amount);

        // 1. User Accounting
        UserAccount memory account = _userAccounts[msg.sender];
        uint256 stakingSharesToBurn = _totalStakingShares.mul(amount).div(totalStaked());

        // User wants to burn the fewest stakingShareSeconds for their AMPLs, so redeem from most
        // recent stakes and go backwards in time.
        uint256 stakingShareSecondsToBurn = 0;
        uint256 sharesLeftToBurn = stakingSharesToBurn;
        while (sharesLeftToBurn > 0) {
            Stake memory lastStake = account.stakes[account.stakes.length - 1];
            if (lastStake.stakingShares <= sharesLeftToBurn) {
                // fully redeem a past stake
                stakingShareSecondsToBurn = stakingShareSecondsToBurn
                    .add(lastStake.stakingShares.mul(now.sub(lastStake.timestampSec)));
                account.stakes.pop();
                sharesLeftToBurn = sharesLeftToBurn.sub(lastStake.stakingShares);
            } else {
                // partially redeem a past stake
                stakingShareSecondsToBurn = stakingShareSecondsToBurn
                    .add(sharesLeftToBurn.mul(now.sub(lastStake.timestamp)));
                lastStake.stakingShares = lastStake.stakingShares.sub(sharesLeftToBurn);
                sharesLeftToBurn = 0;
                break;
            }
        }
        account.stakingShareSeconds = account.stakingShareSeconds.sub(stakingShareSecondsToBurn);
        account.stakingShares = account.stakingShares.sub(stakingSharesToBurn);
        account.lastAccountingTimestampSec = now;
        _userAccounts[msg.sender] = account;

        // 2. Global Accounting
        _totalStakingShareSeconds = _totalStakingShareSeconds.sub(stakingShareSecondsToBurn);
        _totalStakingShares = _totalStakingShares.sub(stakingSharesToBurn);
        // Already set in updateAccounting
        // _lastAccountingTimestampSec = now;

        // interactions
        _unlockedPool.transfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount, totalStakedFor(msg.sender), data);
    }

    function totalStakedFor(address addr) external view returns (uint256) {
        return totalStaked().mul(_userAccounts[msg.sender].stakingShares).div(_totalStakingShares);
    }

    function totalStaked() external view returns (uint256) {
        return _stakingPool.balance();
    }

    function token() external view returns (address) {
        return getStakingToken();
    }

    function supportsHistory() external pure returns (bool) {
        return false;
    }

    function updateAccounting() public {
        // Global accounting
        uint256 newStakingShareSeconds = now.sub(_lastAccountingTimestampSec).mul(_totalStakingShares);
        _totalStakingShareSeconds = _totalStakingShareSeconds.add(newStakingShareSeconds);
        _lastAccountingTimestamp = now;

        // User Accounting
        Account memory user = _userAccounts[msg.sender];
        uint256 newUserStakingShareSeconds = now.sub(user.lastAccountingTimestampSec).mul(user.stakingShares);
        user.stakingShareSeconds = user.stakingShareSeconds.add(newUserStakingShareSeconds);
        user.lastAccountingTimestampSec = now;
        _userAccounts[msg.sender] = user;
    }

    // Unlock schedule & adding tokens
    function addUnlockStageTokens(uint256 numTokens, uint256 unlockTimestamp) public returns (bool);
    function numUnlockStages() public view returns (uint256);
    function unlockTimestampForStage(uint256 stage) public view returns (uint256);
    function unlockTokensForStage(uint256 stage) public view returns (uint256);
}
