pragma solidity 0.4.24;

// TODO:
// - Add LockedTokens
// - Add ERC20 functionality for CVTD tokens

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "./IStaking.sol";
import "./TokenPool.sol";

/**
 *
 */
contract ContVestTokenDist is IStaking, Ownable {
    using SafeMath for uint256;

    event Staked(address indexed user, uint256 amount, uint256 total, bytes data);
    event Unstaked(address indexed user, uint256 amount, uint256 total, bytes data);
    event TokensClaimed(address indexed user, uint256 amount);
    event TokensLocked(uint256 amount, uint256 durationSec, uint256 total);
    event TokensUnlocked(uint256 amount, uint256 total);

    TokenPool private _stakingPool;
    TokenPool private _unlockedPool;
    TokenPool private _lockedPool;

    uint256 private _totalStakingShares = 0;
    uint256 private _totalStakingShareSeconds = 0;
    uint256 private _lastAccountingTimestampSec = 0;
    uint256 private _totalLockedShares = 0;
    uint256 private _maxUnlockSchedules = 0;

    struct Stake {
        uint256 stakingShares;
        uint256 timestampSec;
    }

    struct UserAccount {
        uint256 stakingShares;  // TODO: needed?
        uint256 stakingShareSeconds;  // TODO: needed?
        uint256 lastAccountingTimestampSec;  // TODO: needed?
    }

    struct UnlockSchedule {
        uint256 initialLockedShares;
        uint256 lastUnlockTimestampSec;
        uint256 endAtSec;
        uint256 durationSec;
    }

    mapping(address => UserAccount) private _userAccounts;
    mapping(address => Stake[]) private _userStakes;

    UnlockSchedule[] public unlockSchedules;

    constructor(IERC20 stakingToken, IERC20 distributionToken, uint256 maxUnlockSchedules) public {
        _stakingPool = new TokenPool(stakingToken);
        _unlockedPool = new TokenPool(distributionToken);
        _lockedPool = new TokenPool(distributionToken);

        assert(_stakingPool.owner() == address(this));
        assert(_unlockedPool.owner() == address(this));
        assert(_lockedPool.owner() == address(this));

        _maxUnlockSchedules = maxUnlockSchedules;
    }

    // Pool info
    function getStakingToken() public view returns (IERC20) {
        return _stakingPool.getToken();
    }

    function getDistributionToken() public view returns (IERC20) {
        // assert(_unlockedPool.getToken() == _lockedPool.getToken());
        return _unlockedPool.getToken();
    }

    // Staking
    function stake(uint256 amount, bytes data) external {
        _stakeFor(msg.sender, amount);
    }

    function stakeFor(address user, uint256 amount, bytes data) external {
        _stakeFor(user, amount);
    }

    function _stakeFor(address user, uint256 amount) private {
        updateAccounting();

        // 1. User Accounting
        // TODO: If we start with 1 share = 1 token, will we hit rounding errors in the future?
        uint256 mintedStakingShares = (totalStaked() > 0)
            ? _totalStakingShares.mul(amount).div(totalStaked())
            : amount;

        UserAccount storage account = _userAccounts[user];
        account.stakingShares = account.stakingShares.add(mintedStakingShares);
        account.lastAccountingTimestampSec = now;

        Stake memory newStake = Stake(mintedStakingShares, now);
        _userStakes[user].push(newStake);

        // 2. Global Accounting
        _totalStakingShares = _totalStakingShares.add(mintedStakingShares);
        // Already set in updateAccounting()
        // _lastAccountingTimestampSec = now;

        // interactions
        require(_stakingPool.getToken().transferFrom(user, address(_stakingPool), amount));

        emit Staked(user, amount, totalStakedFor(user), "");
    }

    function unstake(uint256 amount, bytes data) external {
        updateAccounting();

        // checks
        require(amount > 0);
        uint256 userStakedAmpl = totalStakedFor(msg.sender);
        require(userStakedAmpl >= amount);

        // 1. User Accounting
        UserAccount memory account = _userAccounts[msg.sender];
        Stake[] storage accountStakes = _userStakes[msg.sender];
        uint256 stakingSharesToBurn = _totalStakingShares.mul(amount).div(totalStaked());

        // User wants to burn the fewest stakingShareSeconds for their AMPLs, so redeem from most
        // recent stakes and go backwards in time.
        uint256 stakingShareSecondsToBurn = 0;
        uint256 sharesLeftToBurn = stakingSharesToBurn;
        while (sharesLeftToBurn > 0) {
            Stake memory lastStake = accountStakes[accountStakes.length - 1];
            if (lastStake.stakingShares <= sharesLeftToBurn) {
                // fully redeem a past stake
                stakingShareSecondsToBurn = stakingShareSecondsToBurn
                    .add(lastStake.stakingShares.mul(now.sub(lastStake.timestampSec)));
                accountStakes.length--;
                sharesLeftToBurn = sharesLeftToBurn.sub(lastStake.stakingShares);
            } else {
                // partially redeem a past stake
                stakingShareSecondsToBurn = stakingShareSecondsToBurn
                    .add(sharesLeftToBurn.mul(now.sub(lastStake.timestampSec)));
                lastStake.stakingShares = lastStake.stakingShares.sub(sharesLeftToBurn);
                sharesLeftToBurn = 0;
                break;
            }
        }
        account.stakingShareSeconds = account.stakingShareSeconds.sub(stakingShareSecondsToBurn);
        account.stakingShares = account.stakingShares.sub(stakingSharesToBurn);
        account.lastAccountingTimestampSec = now;
        _userAccounts[msg.sender] = account;

        // Calculate the reward amount as a share of user's stakingShareSecondsToBurn to _totalStakingShareSecond
        uint256 rewardAmount = totalUnlocked().mul(stakingShareSecondsToBurn).div(_totalStakingShareSeconds);

        // 2. Global Accounting
        _totalStakingShareSeconds = _totalStakingShareSeconds.sub(stakingShareSecondsToBurn);
        _totalStakingShares = _totalStakingShares.sub(stakingSharesToBurn);
        // Already set in updateAccounting
        // _lastAccountingTimestampSec = now;

        // interactions
        require(_stakingPool.transfer(msg.sender, amount));
        require(_unlockedPool.transfer(msg.sender, rewardAmount));

        emit Unstaked(msg.sender, amount, totalStakedFor(msg.sender), "");
        emit TokensClaimed(msg.sender, rewardAmount);
    }

    function totalRewardsFor(address addr) public view returns (uint256) {
        return _totalStakingShareSeconds > 0 ?
            totalUnlocked().mul(_userAccounts[addr].stakingShareSeconds).div(_totalStakingShareSeconds) : 0;
    }

    function totalStakedFor(address addr) public view returns (uint256) {
        return _totalStakingShares > 0 ?
            totalStaked().mul(_userAccounts[addr].stakingShares).div(_totalStakingShares) : 0;
    }

    function totalStaked() public view returns (uint256) {
        return _stakingPool.balance();
    }

    function token() external view returns (address) {
        return address(getStakingToken());
    }

    function supportsHistory() external pure returns (bool) {
        return false;
    }

    function updateAccounting() public {
        // unlock tokens
        unlockTokens();

        // Global accounting
        uint256 newStakingShareSeconds = now.sub(_lastAccountingTimestampSec).mul(_totalStakingShares);
        _totalStakingShareSeconds = _totalStakingShareSeconds.add(newStakingShareSeconds);
        _lastAccountingTimestampSec = now;

        // User Accounting
        UserAccount memory user = _userAccounts[msg.sender];
        uint256 newUserStakingShareSeconds = now.sub(user.lastAccountingTimestampSec).mul(user.stakingShares);
        user.stakingShareSeconds = user.stakingShareSeconds.add(newUserStakingShareSeconds);
        user.lastAccountingTimestampSec = now;
        _userAccounts[msg.sender] = user;
    }

    // Unlock schedule & adding tokens
    function totalLocked() public view returns (uint256) {
        return _lockedPool.balance();
    }

    function totalUnlocked() public view returns (uint256) {
        return _unlockedPool.balance();
    }

    function lockTokens(uint256 amount, uint256 durationSec) external onlyOwner {
        require(unlockSchedules.length < _maxUnlockSchedules);

        // TODO: If we start with 1 share = 1 token,
        // will we hit rounding errors in the future
        uint256 mintedLockedShares = (totalLocked() > 0)
            ? _totalLockedShares.mul(amount).div(totalLocked())
            : amount;

        UnlockSchedule memory schedule;
        schedule.initialLockedShares = mintedLockedShares;
        schedule.lastUnlockTimestampSec = now;
        schedule.endAtSec = now.add(durationSec);
        schedule.durationSec = durationSec;
        unlockSchedules.push(schedule);

        _totalLockedShares = _totalLockedShares.add(mintedLockedShares);

        require(_lockedPool.getToken().transferFrom(msg.sender, address(_lockedPool), amount));
        emit TokensLocked(amount, durationSec, totalLocked());
    }

    function unlockTokens() public returns (uint256) {
        uint256 unlockedTokens = 0;

        if(_totalLockedShares == 0) {
            unlockedTokens = totalLocked();
        } else {
            uint256 unlockedShares = 0;
            for(uint256 s = 0; s < unlockSchedules.length; s++) {
                unlockedShares += unlockScheduleShares(s);
            }
            unlockedTokens = unlockedShares.mul(totalLocked()).div(_totalLockedShares);
            _totalLockedShares = _totalLockedShares.sub(unlockedShares);
        }

        require(_lockedPool.transfer(address(_unlockedPool), unlockedTokens));
        emit TokensUnlocked(unlockedTokens, totalLocked());

        return unlockedTokens;
    }

    function unlockScheduleShares(uint256 s) private returns (uint256) {
        UnlockSchedule storage schedule = unlockSchedules[s];

        uint256 unlockTimestampSec = (now < schedule.endAtSec) ? now : schedule.endAtSec;
        uint256 unlockedShares = unlockTimestampSec.sub(schedule.lastUnlockTimestampSec)
            .mul(schedule.initialLockedShares)
            .div(schedule.durationSec);

        schedule.lastUnlockTimestampSec = unlockTimestampSec;

        return unlockedShares;
    }
}
