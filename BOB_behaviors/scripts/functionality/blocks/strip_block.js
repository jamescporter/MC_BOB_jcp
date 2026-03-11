import { BlockPermutation, BlockStates, ItemStack, EntityEquippableComponent, EquipmentSlot, system, world } from "@minecraft/server";

world.beforeEvents.playerInteractWithBlock.subscribe(ev => {
    const player = ev.player
    const block = ev.block

    const equipment = player?.getComponent(EntityEquippableComponent.componentId);
    const item = equipment?.getEquipment(EquipmentSlot.Mainhand);
    const durability = item?.getComponent('durability');
    const strippedBlock = block?.typeId + '_stripped';
    const blockFace = block?.permutation.getState('minecraft:block_face');
    if (block?.hasTag(`better_on_bedrock:log`)) {
        if (item?.hasTag('minecraft:is_axe')) {
            if (!strippedBlock) return;
            system.run(() => {
                block.setPermutation(BlockPermutation.resolve(strippedBlock, {
                    'minecraft:block_face': blockFace
                }));
            });
            system.run(() => {
                player.playSound('fall.wood');
            });
            if (durability && durability.damage < durability.maxDurability) {
                system.run(() => {
                    if (!equipment) return;
                    durability.damage++;
                    equipment.setEquipment(EquipmentSlot.Mainhand, item);
                });
            }
            if (durability && durability.damage >= durability.maxDurability) {
                system.run(() => {
                    if (!equipment) return;
                    player.playSound('random.break');
                    equipment.setEquipment(EquipmentSlot.Mainhand, new ItemStack('minecraft:air', 1));
                });
            }
        }
    }
})
