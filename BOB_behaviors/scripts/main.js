import { world, system, BlockTypes, BlockPermutation, BlockVolume, EntityEquippableComponent, EntityInventoryComponent, EquipmentSlot, ItemStack } from "@minecraft/server";
export const blocks = BlockTypes.getAll().map((block) => block.id);

import { wawla } from "./functionality/wawla.js";
import { ghostNecklace } from "./functionality/items/ghost-necklace.js";
import { voidTotem } from "./functionality/items/void-totem.js";
import { voidBoots } from "./functionality/items/void-boots.js";

// import { poggy } from "./functionality/entities/poggy.js";
import { seeker } from "./functionality/entities/seeker.js";
import { sootEye } from "./functionality/entities/soot_eye.js";

import { registerBlockComponents, registerItemComponents } from "./custom_components/index.js";

import "./scripting_events/index.js";
import "./functionality/index.js";
import "./functionality/entities/inferior.js";
import "./functionality/custom_spear/handler.js";

import "./functionality/entities/seeker.js";
import "./functionality/entities/seeker_teleport.js";

import "./functionality/blocks/jukebox.js";
import "./functionality/blocks/strip_block.js";

import "./functionality/enchanted/main.js";

// Imports our custom components
import { wall_Manager } from './custom_components/blocks/walls/wall_Manager.js'
import { ambience } from "./functionality/ambience/ambient_stuff.js";

import { flushQuestLoopContext, loopQuestsWithContext, loopSecretQuestsWithContext } from "./functionality/quests/behavior.js"
import { loopGoals } from "./functionality/goals/goals.js";

world.afterEvents.playerBreakBlock.subscribe(
    (data) => wall_Manager.updateWallsAround(data.block)
);

world.afterEvents.playerPlaceBlock.subscribe(
    (data) => wall_Manager.updateWallsAround(data.block)
);


/** @param { import("@minecraft/server").Vector3 } vector */
function vectorLength(vector) {
    const x = Math.pow(vector.x, 2);
    const y = Math.pow(vector.y, 2);
    const z = Math.pow(vector.z, 2);
    return Math.sqrt(x + y + z);
};

const FAST_PLAYER_DIVISOR = 2;
const SLOW_PLAYER_DIVISOR = 2;
const SLOW_INTERVAL_TICKS = 20;
const FORCE_SLOW_RESCAN_TICKS = 120;

let fastPlayerCursor = 0;
let slowPlayerCursor = 0;
let globalTick = 0;

const playerStateCache = new Map();
const proximityCache = new Map();
let proximityCacheTick = -1;

function normalizeList(values) {
    if (!values?.length)
        return "";

    return values.join(",");
}

function getProximityCacheKey(player, queryOptions) {
    return [
        player.id,
        queryOptions.maxDistance ?? "",
        queryOptions.closest ?? "",
        queryOptions.farthest ?? "",
        queryOptions.type ?? "",
        normalizeList(queryOptions.tags),
        normalizeList(queryOptions.excludeTags),
        normalizeList(queryOptions.families),
        normalizeList(queryOptions.excludeFamilies)
    ].join("|");
}

export function getEntitiesNearPlayerCached(player, queryOptions) {
    const currentTick = system.currentTick;
    if (proximityCacheTick !== currentTick) {
        proximityCache.clear();
        proximityCacheTick = currentTick;
    }

    const cacheKey = getProximityCacheKey(player, queryOptions);
    const cached = proximityCache.get(cacheKey);
    if (cached)
        return cached;

    const entities = player.dimension.getEntities({
        ...queryOptions,
        location: player.location
    });

    proximityCache.set(cacheKey, entities);
    return entities;
}

/** @param { import("@minecraft/server").Player } player */
function getEquipmentSignature(player) {
    const equipment = player.getComponent(EntityEquippableComponent.componentId);
    if (!equipment)
        return "none";

    return [
        equipment.getEquipment(EquipmentSlot.Head)?.typeId ?? "",
        equipment.getEquipment(EquipmentSlot.Chest)?.typeId ?? "",
        equipment.getEquipment(EquipmentSlot.Legs)?.typeId ?? "",
        equipment.getEquipment(EquipmentSlot.Feet)?.typeId ?? "",
        equipment.getEquipment(EquipmentSlot.Mainhand)?.typeId ?? "",
        equipment.getEquipment(EquipmentSlot.Offhand)?.typeId ?? ""
    ].join("|");
};

function getPlayerSlice(players, cursor, divisor) {
    if (players.length === 0)
        return { players: [], cursor: 0 };

    const sliceSize = Math.max(1, Math.ceil(players.length / divisor));
    const slice = [];
    for (let i = 0; i < sliceSize; i++) {
        const index = (cursor + i) % players.length;
        slice.push(players[index]);
    };

    return {
        players: slice,
        cursor: (cursor + sliceSize) % players.length
    };
};

// High cadence checks (combat and movement)
system.runInterval(() => {
    system.runJob(function *() {
        const players = world.getAllPlayers();
        const playerSlice = getPlayerSlice(players, fastPlayerCursor, FAST_PLAYER_DIVISOR);
        fastPlayerCursor = playerSlice.cursor;

        for (let i = 0; i < playerSlice.players.length; i++) {
            const player = playerSlice.players[i];
            if (!player?.isValid())
                continue;

            // First time moving
            const velocityVector = player.getVelocity();
            const velocity = vectorLength({ x: velocityVector.x, y: 0, z: velocityVector.z });
            if (velocity > 0 && !player.hasTag("introMove")) {
                player.addTag("introMove");

                player.sendMessage([
                    { text: "§6[!] §r" },
                    { translate: "bob.message.welcome" },
                ]);
                player.sendMessage("bob.toast;achievement.0");
                player.playSound("normal_quest");

                const container = player.getComponent(EntityInventoryComponent.componentId).container;
                container.addItem(new ItemStack("better_on_bedrock:config"));
                container.addItem(new ItemStack("better_on_bedrock:quest_paper"));
                container.addItem(new ItemStack("better_on_bedrock:lost_journal"));
            };

            yield voidTotem(player);
            yield voidBoots(player);

            if (player.hasTag("bob:disable_combat_checks"))
                continue;

            // Boss attacks (high cadence only)
            yield seeker(player);
            yield sootEye(player);

            if (player.hasTag("toolTip"))
                yield wawla(player);
        };
    }());
}, 2);

// Low cadence checks (inventory and ambient)
system.runInterval(() => {
    system.runJob(function* () {
        const players = world.getAllPlayers();
        const activeIds = new Set(players.map((player) => player.id));
        for (const playerId of playerStateCache.keys()) {
            if (!activeIds.has(playerId))
                playerStateCache.delete(playerId);
        };

        const playerSlice = getPlayerSlice(players, slowPlayerCursor, SLOW_PLAYER_DIVISOR);
        slowPlayerCursor = playerSlice.cursor;

        for (let i = 0; i < playerSlice.players.length; i++) {
            const player = playerSlice.players[i];
            if (!player?.isValid())
                continue;

            if (!player.hasTag('joined3')) {
                player.addTag('joined3')
            }
            else if (player.getDynamicProperty("tiersCompleted") == void 0) {
                player.setDynamicProperty("tiersCompleted", 0);
            };

            const state = playerStateCache.get(player.id) ?? {
                equipmentSignature: "",
                lastSlowScanTick: -FORCE_SLOW_RESCAN_TICKS,
                hasFixedGhostNecklace: false,
                slotSignatures: new Map(),
            };

            const equipmentSignature = getEquipmentSignature(player);
            const hasRelevantTags = player.hasTag("pog:ambientSounds");
            const shouldForceRescan = (globalTick - state.lastSlowScanTick) >= FORCE_SLOW_RESCAN_TICKS;
            const isEquipmentUnchanged = state.equipmentSignature === equipmentSignature;

            if (!shouldForceRescan && isEquipmentUnchanged && !hasRelevantTags && !state.hasFixedGhostNecklace)
                continue;

            if (player.hasTag("pog:ambientSounds"))
                yield ambience(player);

            state.hasFixedGhostNecklace = ghostNecklace(player);

            if (shouldForceRescan || !isEquipmentUnchanged)
                state.slotSignatures.clear();

            if (!player.hasTag("bob:skip_inventory_scan"))
                yield inventoryLoop(player);

            state.equipmentSignature = equipmentSignature;
            state.lastSlowScanTick = globalTick;
            playerStateCache.set(player.id, state);
        };
    }());

    globalTick += SLOW_INTERVAL_TICKS;
}, SLOW_INTERVAL_TICKS);

function inventoryLoop(player) {
    if (!player.hasTag('joined3'))
        return;

    const inventory = player.getComponent("inventory").container;
    const state = playerStateCache.get(player.id);
    if (!state)
        return;

    const questLoopContext = {
        tierStates: new Map(),
        secretState: undefined,
    };

    for (let slot = 0; slot < inventory.size; slot++) {
        const itemStack = inventory.getItem(slot);
        if (!itemStack) {
            state.slotSignatures.delete(slot);
            continue;
        }

        const slotSignature = getSlotSignature(itemStack);
        if (state.slotSignatures.get(slot) === slotSignature)
            continue;

        state.slotSignatures.set(slot, slotSignature);

        loopQuestsWithContext(player, itemStack, questLoopContext);
        loopSecretQuestsWithContext(player, itemStack, questLoopContext);
        loopGoals(player, itemStack);
    }

    flushQuestLoopContext(player, questLoopContext);
};

function getSlotSignature(itemStack) {
    const lore = itemStack.getLore();
    const loreHash = lore.length ? lore.join("\u001f") : "";
    return `${itemStack.typeId}|${loreHash}|${itemStack.amount}`;
}

// Custom Components
world.beforeEvents.worldInitialize.subscribe(
    ({ blockComponentRegistry, itemComponentRegistry }) => {
        registerBlockComponents(blockComponentRegistry);
        registerItemComponents(itemComponentRegistry);
    },
);


// -----------------------------------------------------------------------------
// Expiring torch system (Bedrock Script API 1.21+)
// -----------------------------------------------------------------------------

const EXPIRING_TORCH_BLOCK_ID = "better_on_bedrock:expiring_torch";
const TORCH_LIFESPAN_PROPERTY = "better_on_bedrock:torch_lifespan";
const TORCH_SCAN_RADIUS_PROPERTY = "better_on_bedrock:scan_radius";
const DEFAULT_TORCH_LIFESPAN = 12000;
const DEFAULT_SCAN_RADIUS = 24;

/**
 * Ensures our configurable world properties exist.
 * Values can then be changed later via scripts/commands as needed.
 */
function initialiseExpiringTorchProperties() {
    if (world.getDynamicProperty(TORCH_LIFESPAN_PROPERTY) === undefined)
        world.setDynamicProperty(TORCH_LIFESPAN_PROPERTY, DEFAULT_TORCH_LIFESPAN);

    if (world.getDynamicProperty(TORCH_SCAN_RADIUS_PROPERTY) === undefined)
        world.setDynamicProperty(TORCH_SCAN_RADIUS_PROPERTY, DEFAULT_SCAN_RADIUS);
}

/**
 * Converts a vanilla torch-facing value into a minecraft:block_face value.
 * Supports both likely state key variants used by torches.
 * @param {import("@minecraft/server").BlockPermutation} permutation
 */
function getPlacementFaceFromPermutation(permutation) {
    const states = permutation.getAllStates();

    const blockFace = states["minecraft:block_face"];
    if (typeof blockFace === "string")
        return blockFace;

    const torchFacing = states["minecraft:torch_facing_direction"];
    if (typeof torchFacing === "string")
        return torchFacing;

    const cardinal = states["minecraft:cardinal_direction"];
    if (typeof cardinal === "string")
        return cardinal;

    return "up";
}

/**
 * Replaces a block with our expiring torch proxy while preserving face when possible.
 * @param {import("@minecraft/server").Block} block
 */
function replaceWithExpiringTorch(block) {
    const face = getPlacementFaceFromPermutation(block.permutation);
    block.setPermutation(BlockPermutation.resolve(EXPIRING_TORCH_BLOCK_ID, {
        "minecraft:block_face": face,
    }));
}

// Register the block custom component during startup.
world.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    initialiseExpiringTorchProperties();

    blockComponentRegistry.registerCustomComponent("better_on_bedrock:expire_torch", {
        /**
         * Called by the block's minecraft:tick component.
         * We simply turn the torch into air when it expires.
         */
        onTick({ block }) {
            block.setPermutation(BlockPermutation.resolve("minecraft:air"));
        },
    });
});

// Intercept direct placement and immediately proxy vanilla torches to expiring torches.
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (!block?.isValid())
        return;

    if (block.typeId !== "minecraft:torch" && block.typeId !== "minecraft:wall_torch")
        return;

    replaceWithExpiringTorch(block);
});

// Background scanner: continuously converts nearby vanilla torches to expiring torches.
system.runInterval(() => {
    const players = world.getAllPlayers();
    if (players.length <= 0)
        return;

    const configuredRadius = Number(world.getDynamicProperty(TORCH_SCAN_RADIUS_PROPERTY));
    const radius = Number.isFinite(configuredRadius) ? Math.max(1, Math.floor(configuredRadius)) : DEFAULT_SCAN_RADIUS;

    for (const player of players) {
        if (!player?.isValid())
            continue;

        const { x, y, z } = player.location;
        const min = {
            x: Math.floor(x - radius),
            y: Math.max(-64, Math.floor(y - radius)),
            z: Math.floor(z - radius),
        };
        const max = {
            x: Math.floor(x + radius),
            y: Math.min(320, Math.floor(y + radius)),
            z: Math.floor(z + radius),
        };

        const scanVolume = new BlockVolume(min, max);

        // Floor torches become expiring torches facing up.
        player.dimension.fillBlocks(
            scanVolume,
            BlockPermutation.resolve(EXPIRING_TORCH_BLOCK_ID, { "minecraft:block_face": "up" }),
            {
                blockFilter: {
                    includeTypes: ["minecraft:torch"],
                },
                ignoreChunkBoundErrors: true,
            }
        );

        // Wall torches become expiring wall-style torches.
        player.dimension.fillBlocks(
            scanVolume,
            BlockPermutation.resolve(EXPIRING_TORCH_BLOCK_ID, { "minecraft:block_face": "north" }),
            {
                blockFilter: {
                    includeTypes: ["minecraft:wall_torch"],
                },
                ignoreChunkBoundErrors: true,
            }
        );
    }
}, 100);
