// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeMathCompatibility } from "./_utils/SafeMathCompatibility.sol";
import { ITokenPool } from "./ITokenPool.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ITokenGeyser } from "./ITokenGeyser.sol";

/**
 * @title Token Geyser
 * @dev A smart-contract based mechanism to distribute tokens over time, inspired loosely by
 *      Compound and Uniswap.
 *
 *      Distribution tokens are added to a locked pool in the contract and become unlocked over time
 *      according to a once-configurable unlock schedule. Once unlocked, they are available to be
 *      claimed by users.
 *
 *      A user may deposit tokens to accrue ownership share over the unlocked pool. This owner share
 *      is a function of the number of tokens deposited as well as the length of time deposited.
 *      Specifically, a user's share of the currently-unlocked pool equals their "deposit-seconds"
 *      divided by the global "deposit-seconds". This aligns the new token distribution with long
 *      term supporters of the project, addressing one of the major drawbacks of simple airdrops.
 *
 *      More background and motivation available at:
 *      https://github.com/ampleforth/RFCs/blob/master/RFCs/rfc-1.md
 */
contract TokenGeyser is
    ITokenGeyser,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeMathCompatibility for uint256;
    using SafeERC20 for IERC20;

    //-------------------------------------------------------------------------
    // Events

    event Staked(address indexed user, uint256 amount, uint256 total);
    event Unstaked(address indexed user, uint256 amount, uint256 total);
    event TokensClaimed(address indexed user, uint256 amount);
    event TokensLocked(uint256 amount, uint256 durationSec, uint256 total);
    // amount: Unlocked tokens, total: Total locked tokens
    event TokensUnlocked(uint256 amount, uint256 total);

    //-------------------------------------------------------------------------
    // Storage

    ITokenPool public stakingPool;
    ITokenPool public unlockedPool;
    ITokenPool public lockedPool;

    //
    // Time-bonus params
    //
    uint256 public constant BONUS_DECIMALS = 2;
    uint256 public startBonus;
    uint256 public bonusPeriodSec;

    //
    // Global accounting state
    //
    uint256 public totalLockedShares;
    uint256 public totalStakingShares;
    uint256 public totalStakingShareSeconds;
    uint256 public lastAccountingTimestampSec;
    uint256 public maxUnlockSchedules;
    uint256 public initialSharesPerToken;

    //
    // User accounting state
    //
    // Represents a single stake for a user. A user may have multiple.
    struct Stake {
        uint256 stakingShares;
        uint256 timestampSec;
    }

    // Caches aggregated values from the User->Stake[] map to save computation.
    // If lastAccountingTimestampSec is 0, there's no entry for that user.
    struct UserTotals {
        uint256 stakingShares;
        uint256 stakingShareSeconds;
        uint256 lastAccountingTimestampSec;
    }

    // Aggregated staking values per user
    mapping(address => UserTotals) public userTotals;

    // The collection of stakes for each user. Ordered by timestamp, earliest to latest.
    mapping(address => Stake[]) public userStakes;

    //
    // Locked/Unlocked Accounting state
    //
    struct UnlockSchedule {
        uint256 initialLockedShares;
        uint256 unlockedShares;
        uint256 lastUnlockTimestampSec;
        uint256 endAtSec;
        uint256 durationSec;
    }

    UnlockSchedule[] public unlockSchedules;

    //-------------------------------------------------------------------------
    // Construction

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param stakingToken_ The token users deposit as stake.
     * @param distributionToken_ The token users receive as they unstake.
     * @param maxUnlockSchedules_ Max number of unlock stages, to guard against hitting gas limit.
     * @param startBonus_ Starting time bonus, BONUS_DECIMALS fixed point.
     *                    e.g. 25% means user gets 25% of max distribution tokens.
     * @param bonusPeriodSec_ Length of time for bonus to increase linearly to max.
     * @param initialSharesPerToken_ Number of shares to mint per staking token on first stake.
     */
    function init(
        address tokenPoolImpl,
        IERC20 stakingToken_,
        IERC20 distributionToken_,
        uint256 maxUnlockSchedules_,
        uint256 startBonus_,
        uint256 bonusPeriodSec_,
        uint256 initialSharesPerToken_
    ) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        // The start bonus must be some fraction of the max. (i.e. <= 100%)
        require(startBonus_ <= 10 ** BONUS_DECIMALS, "TokenGeyser: start bonus too high");
        // If no period is desired, instead set startBonus = 100%
        // and bonusPeriod to a small value like 1 sec.
        require(bonusPeriodSec_ != 0, "TokenGeyser: bonus period is zero");
        require(initialSharesPerToken_ > 0, "TokenGeyser: initialSharesPerToken is zero");

        stakingPool = ITokenPool(Clones.clone(tokenPoolImpl));
        stakingPool.init(stakingToken_);

        unlockedPool = ITokenPool(Clones.clone(tokenPoolImpl));
        unlockedPool.init(distributionToken_);

        lockedPool = ITokenPool(Clones.clone(tokenPoolImpl));
        lockedPool.init(distributionToken_);

        startBonus = startBonus_;
        bonusPeriodSec = bonusPeriodSec_;

        totalLockedShares = 0;
        totalStakingShares = 0;
        totalStakingShareSeconds = 0;
        lastAccountingTimestampSec = block.timestamp;
        maxUnlockSchedules = maxUnlockSchedules_;
        initialSharesPerToken = initialSharesPerToken_;
    }

    //-------------------------------------------------------------------------
    // External and public methods

    /**
     * @return The token users deposit as stake.
     */
    function stakingToken() public view override returns (IERC20) {
        return stakingPool.token();
    }

    /**
     * @return The token users receive as they unstake.
     */
    function distributionToken() public view override returns (IERC20) {
        assert(unlockedPool.token() == lockedPool.token());
        return unlockedPool.token();
    }

    /**
     * @notice Transfers amount of deposit tokens from the user.
     * @param amount Number of deposit tokens to stake.
     */
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "TokenGeyser: stake amount is zero");
        require(
            totalStakingShares == 0 || totalStaked() > 0,
            "TokenGeyser: Staking shares exist, but no staking tokens do"
        );

        uint256 mintedStakingShares = (totalStakingShares > 0)
            ? totalStakingShares.mul(amount).div(totalStaked())
            : amount.mul(initialSharesPerToken);
        require(mintedStakingShares > 0, "TokenGeyser: Stake amount is too small");

        _updateAccounting();

        // 1. User Accounting
        UserTotals storage totals = userTotals[msg.sender];
        totals.stakingShares = totals.stakingShares.add(mintedStakingShares);
        totals.lastAccountingTimestampSec = block.timestamp;

        Stake memory newStake = Stake(mintedStakingShares, block.timestamp);
        userStakes[msg.sender].push(newStake);

        // 2. Global Accounting
        totalStakingShares = totalStakingShares.add(mintedStakingShares);
        // Already set in _updateAccounting()
        // lastAccountingTimestampSec = block.timestamp;

        // interactions
        stakingPool.token().safeTransferFrom(msg.sender, address(stakingPool), amount);
        emit Staked(msg.sender, amount, totalStakedFor(msg.sender));
    }

    /**
     * @notice Unstakes a certain amount of previously deposited tokens. User also receives their
     * allotted number of distribution tokens.
     * @param amount Number of deposit tokens to unstake / withdraw.
     */
    function unstake(
        uint256 amount
    ) external nonReentrant whenNotPaused returns (uint256) {
        _updateAccounting();

        // checks
        require(amount > 0, "TokenGeyser: unstake amount is zero");
        require(
            totalStakedFor(msg.sender) >= amount,
            "TokenGeyser: unstake amount is greater than total user stakes"
        );
        uint256 stakingSharesToBurn = totalStakingShares.mul(amount).div(totalStaked());
        require(
            stakingSharesToBurn > 0,
            "TokenGeyser: Unable to unstake amount this small"
        );

        // 1. User Accounting
        UserTotals storage totals = userTotals[msg.sender];
        Stake[] storage accountStakes = userStakes[msg.sender];

        // Redeem from most recent stake and go backwards in time.
        uint256 stakingShareSecondsToBurn = 0;
        uint256 sharesLeftToBurn = stakingSharesToBurn;
        uint256 rewardAmount = 0;
        while (sharesLeftToBurn > 0) {
            Stake storage lastStake = accountStakes[accountStakes.length - 1];
            uint256 stakeTimeSec = block.timestamp.sub(lastStake.timestampSec);
            uint256 newStakingShareSecondsToBurn = 0;
            if (lastStake.stakingShares <= sharesLeftToBurn) {
                // fully redeem a past stake
                newStakingShareSecondsToBurn = lastStake.stakingShares.mul(stakeTimeSec);
                rewardAmount = computeNewReward(
                    rewardAmount,
                    newStakingShareSecondsToBurn,
                    stakeTimeSec
                );
                stakingShareSecondsToBurn = stakingShareSecondsToBurn.add(
                    newStakingShareSecondsToBurn
                );
                sharesLeftToBurn = sharesLeftToBurn.sub(lastStake.stakingShares);
                accountStakes.pop();
            } else {
                // partially redeem a past stake
                newStakingShareSecondsToBurn = sharesLeftToBurn.mul(stakeTimeSec);
                rewardAmount = computeNewReward(
                    rewardAmount,
                    newStakingShareSecondsToBurn,
                    stakeTimeSec
                );
                stakingShareSecondsToBurn = stakingShareSecondsToBurn.add(
                    newStakingShareSecondsToBurn
                );
                lastStake.stakingShares = lastStake.stakingShares.sub(sharesLeftToBurn);
                sharesLeftToBurn = 0;
            }
        }
        totals.stakingShareSeconds = totals.stakingShareSeconds.sub(
            stakingShareSecondsToBurn
        );
        totals.stakingShares = totals.stakingShares.sub(stakingSharesToBurn);
        // Already set in updateAccounting
        // totals.lastAccountingTimestampSec = block.timestamp;

        // 2. Global Accounting
        totalStakingShareSeconds = totalStakingShareSeconds.sub(
            stakingShareSecondsToBurn
        );
        totalStakingShares = totalStakingShares.sub(stakingSharesToBurn);
        // Already set in updateAccounting
        // lastAccountingTimestampSec = block.timestamp;

        // interactions
        stakingPool.transfer(msg.sender, amount);
        unlockedPool.transfer(msg.sender, rewardAmount);

        emit Unstaked(msg.sender, amount, totalStakedFor(msg.sender));
        emit TokensClaimed(msg.sender, rewardAmount);

        require(
            totalStakingShares == 0 || totalStaked() > 0,
            "TokenGeyser: Staking shares exist, but no staking tokens do"
        );
        return rewardAmount;
    }

    /**
     * @notice Applies an additional time-bonus to a distribution amount. This is necessary to
     *      encourage long-term deposits instead of constant unstake/restakes.
     *      The bonus-multiplier is the result of a linear function that starts at startBonus and
     *      ends at 100% over bonusPeriodSec, then stays at 100% thereafter.
     * @param currentRewardTokens The current number of distribution tokens already alotted for this
     *                            unstake op. Any bonuses are already applied.
     * @param stakingShareSeconds The stakingShare-seconds that are being burned for new
     *                            distribution tokens.
     * @param stakeTimeSec Length of time for which the tokens were staked. Needed to calculate
     *                     the time-bonus.
     * @return Updated amount of distribution tokens to award, with any bonus included on the
     *         newly added tokens.
     */
    function computeNewReward(
        uint256 currentRewardTokens,
        uint256 stakingShareSeconds,
        uint256 stakeTimeSec
    ) public view returns (uint256) {
        uint256 newRewardTokens = totalUnlocked().mul(stakingShareSeconds).div(
            totalStakingShareSeconds
        );

        if (stakeTimeSec >= bonusPeriodSec) {
            return currentRewardTokens.add(newRewardTokens);
        }

        uint256 oneHundredPct = 10 ** BONUS_DECIMALS;
        uint256 bonusedReward = startBonus
            .add(oneHundredPct.sub(startBonus).mul(stakeTimeSec).div(bonusPeriodSec))
            .mul(newRewardTokens)
            .div(oneHundredPct);
        return currentRewardTokens.add(bonusedReward);
    }

    /**
     * @param addr The user to look up staking information for.
     * @return The number of staking tokens deposited for address.
     */
    function totalStakedFor(address addr) public view returns (uint256) {
        return
            totalStakingShares > 0
                ? totalStaked().mul(userTotals[addr].stakingShares).div(
                    totalStakingShares
                )
                : 0;
    }

    /**
     * @return The total number of deposit tokens staked globally, by all users.
     */
    function totalStaked() public view returns (uint256) {
        return stakingPool.balance();
    }

    /**
     * @notice A globally callable function to update the accounting state of the system.
     *      Global state and state for the caller are updated.
     * @return [0] balance of the locked pool
     * @return [1] balance of the unlocked pool
     * @return [2] caller's staking share seconds
     * @return [3] global staking share seconds
     * @return [4] Rewards caller has accumulated, optimistically assumes max time-bonus.
     * @return [5] block timestamp
     */
    function updateAccounting()
        external
        nonReentrant
        whenNotPaused
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        return _updateAccounting();
    }

    /**
     * @return Total number of locked distribution tokens.
     */
    function totalLocked() public view override returns (uint256) {
        return lockedPool.balance();
    }

    /**
     * @return Total number of unlocked distribution tokens.
     */
    function totalUnlocked() public view override returns (uint256) {
        return unlockedPool.balance();
    }

    /**
     * @return Number of unlock schedules.
     */
    function unlockScheduleCount() external view returns (uint256) {
        return unlockSchedules.length;
    }

    /**
     * @notice Moves distribution tokens from the locked pool to the unlocked pool, according to the
     *      previously defined unlock schedules. Publicly callable.
     * @return Number of newly unlocked distribution tokens.
     */
    function unlockTokens() external nonReentrant whenNotPaused returns (uint256) {
        return _unlockTokens();
    }

    //-------------------------------------------------------------------------
    // Admin only methods

    /// @notice Pauses all user interactions.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses all user interactions.
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev This function allows the contract owner to add more locked distribution tokens, along
     *      with the associated "unlock schedule". These locked tokens immediately begin unlocking
     *      linearly over the duration of durationSec time frame.
     * @param amount Number of distribution tokens to lock. These are transferred from the caller.
     * @param durationSec Length of time to linear unlock the tokens.
     */
    function lockTokens(uint256 amount, uint256 durationSec) external onlyOwner {
        require(
            unlockSchedules.length < maxUnlockSchedules,
            "TokenGeyser: reached maximum unlock schedules"
        );

        // Update lockedTokens amount before using it in computations after.
        _updateAccounting();

        uint256 lockedTokens = totalLocked();
        uint256 mintedLockedShares = (lockedTokens > 0)
            ? totalLockedShares.mul(amount).div(lockedTokens)
            : amount.mul(initialSharesPerToken);

        UnlockSchedule memory schedule;
        schedule.initialLockedShares = mintedLockedShares;
        schedule.lastUnlockTimestampSec = block.timestamp;
        schedule.endAtSec = block.timestamp.add(durationSec);
        schedule.durationSec = durationSec;
        unlockSchedules.push(schedule);

        totalLockedShares = totalLockedShares.add(mintedLockedShares);

        lockedPool.token().safeTransferFrom(msg.sender, address(lockedPool), amount);
        emit TokensLocked(amount, durationSec, totalLocked());
    }

    /**
     * @dev Lets the owner rescue funds air-dropped to the staking pool.
     * @param tokenToRescue Address of the token to be rescued.
     * @param to Address to which the rescued funds are to be sent.
     * @param amount Amount of tokens to be rescued.
     */
    function rescueFundsFromStakingPool(
        address tokenToRescue,
        address to,
        uint256 amount
    ) external onlyOwner {
        stakingPool.rescueFunds(tokenToRescue, to, amount);
    }

    //-------------------------------------------------------------------------
    // Private methods

    /**
     * @dev Updates time-dependent global storage state.
     */
    function _updateAccounting()
        private
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        _unlockTokens();

        // Global accounting
        uint256 newStakingShareSeconds = block
            .timestamp
            .sub(lastAccountingTimestampSec)
            .mul(totalStakingShares);
        totalStakingShareSeconds = totalStakingShareSeconds.add(newStakingShareSeconds);
        lastAccountingTimestampSec = block.timestamp;

        // User Accounting
        UserTotals storage totals = userTotals[msg.sender];
        uint256 newUserStakingShareSeconds = block
            .timestamp
            .sub(totals.lastAccountingTimestampSec)
            .mul(totals.stakingShares);
        totals.stakingShareSeconds = totals.stakingShareSeconds.add(
            newUserStakingShareSeconds
        );
        totals.lastAccountingTimestampSec = block.timestamp;

        uint256 totalUserRewards = (totalStakingShareSeconds > 0)
            ? totalUnlocked().mul(totals.stakingShareSeconds).div(
                totalStakingShareSeconds
            )
            : 0;

        return (
            totalLocked(),
            totalUnlocked(),
            totals.stakingShareSeconds,
            totalStakingShareSeconds,
            totalUserRewards,
            block.timestamp
        );
    }

    /**
     * @dev Unlocks distribution tokens based on reward schedule.
     */
    function _unlockTokens() private returns (uint256) {
        uint256 unlockedTokens = 0;
        uint256 lockedTokens = totalLocked();

        if (totalLockedShares == 0) {
            unlockedTokens = lockedTokens;
        } else {
            uint256 unlockedShares = 0;
            for (uint256 s = 0; s < unlockSchedules.length; s++) {
                unlockedShares = unlockedShares.add(_unlockScheduleShares(s));
            }
            unlockedTokens = unlockedShares.mul(lockedTokens).div(totalLockedShares);
            totalLockedShares = totalLockedShares.sub(unlockedShares);
        }

        if (unlockedTokens > 0) {
            lockedPool.transfer(address(unlockedPool), unlockedTokens);
            emit TokensUnlocked(unlockedTokens, totalLocked());
        }

        return unlockedTokens;
    }

    /**
     * @dev Returns the number of unlock-able shares from a given schedule. The returned value
     *      depends on the time since the last unlock. This function updates schedule accounting,
     *      but does not actually transfer any tokens.
     * @param s Index of the unlock schedule.
     * @return The number of unlocked shares.
     */
    function _unlockScheduleShares(uint256 s) private returns (uint256) {
        UnlockSchedule storage schedule = unlockSchedules[s];

        if (schedule.unlockedShares >= schedule.initialLockedShares) {
            return 0;
        }

        uint256 sharesToUnlock = 0;
        // Special case to handle any leftover dust from integer division
        if (block.timestamp >= schedule.endAtSec) {
            sharesToUnlock = (schedule.initialLockedShares.sub(schedule.unlockedShares));
            schedule.lastUnlockTimestampSec = schedule.endAtSec;
        } else {
            sharesToUnlock = block
                .timestamp
                .sub(schedule.lastUnlockTimestampSec)
                .mul(schedule.initialLockedShares)
                .div(schedule.durationSec);
            schedule.lastUnlockTimestampSec = block.timestamp;
        }

        schedule.unlockedShares = schedule.unlockedShares.add(sharesToUnlock);
        return sharesToUnlock;
    }
}
