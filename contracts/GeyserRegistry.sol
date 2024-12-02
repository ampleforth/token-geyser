// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title GeyserRegistry
contract GeyserRegistry is Ownable {
    mapping(address => bool) public geysers;

    event InstanceAdded(address instance);
    event InstanceRemoved(address instance);

    constructor() Ownable(msg.sender) {}

    function register(address instance) external onlyOwner {
        require(!geysers[instance], "GeyserRegistry: Geyser already registered");
        geysers[instance] = true;
        emit InstanceAdded(instance);
    }

    function deregister(address instance) external onlyOwner {
        require(geysers[instance], "GeyserRegistry: Geyser not registered");
        delete geysers[instance];
        emit InstanceRemoved(instance);
    }
}
