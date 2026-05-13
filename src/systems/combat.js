import * as THREE from 'three';
import { buildingCenter } from './buildings.js';
import { dist2 } from '../utils/helpers.js';

let projectileId = 1;
let fxId = 1;

export function spawnProjectile(sceneCtx, from, to, color = 0xffd88a, payload = null) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(.08, 6, 6),
    new THREE.MeshBasicMaterial({ color })
  );
  mesh.position.copy(from);
  sceneCtx.groups.effects.add(mesh);
  return { id: `p-${projectileId++}`, from: from.clone(), to: to.clone(), t: 0, mesh, kind: 'projectile', payload };
}

function spawnBurst(sceneCtx, pos, color = 0xffb16e, count = 8) {
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(.05 + Math.random() * .04, 5, 5), new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(pos);
    sceneCtx.groups.effects.add(mesh);
    sceneCtx.effectBursts.push({
      id: `fx-${fxId++}`,
      mesh,
      vel: new THREE.Vector3((Math.random() - .5) * 2.5, Math.random() * 2.2, (Math.random() - .5) * 2.5),
      life: .45 + Math.random() * .35,
      kind: 'burst'
    });
  }
}

export function spawnCollapse(sceneCtx, pos, color = 0x8f7650) {
  spawnBurst(sceneCtx, pos.clone().add(new THREE.Vector3(0, .5, 0)), color, 20);
}

export function updateDefense(sceneCtx, state, dt) {
  for (const building of state.buildings) {
    if (!['tower', 'capital', 'barracks'].includes(building.type)) continue;
    building.cooldown = Math.max(0, building.cooldown - dt);
    const center = buildingCenter(state, building);
    let best = null;
    let bestD = Infinity;
    state.units.forEach((u) => {
      if (!u.hostile) return;
      const d = dist2(center, u.pos);
      const range = building.type === 'tower' ? 8 : 5;
      if (d < bestD && d <= range) {
        bestD = d;
        best = u;
      }
    });
    if (best && building.cooldown <= 0) {
      const damage = building.type === 'tower' ? 9 : 5;
      best.hp -= damage;
      best.hitFlash = .18;
      best.attackFlash = .12;
      building.hitFlash = .1;
      building.cooldown = building.type === 'tower' ? 1.2 : 1.7;
      const color = building.type === 'tower' ? 0xffd88a : 0xffb36c;
      state.projectiles.push(spawnProjectile(sceneCtx, center.clone().add(new THREE.Vector3(0, 1.1, 0)), best.pos.clone().add(new THREE.Vector3(0, .8, 0)), color));
    }
  }
}

export function updateProjectiles(sceneCtx, state, dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.t += dt * 3.2;
    p.mesh.position.lerpVectors(p.from, p.to, p.t);
    p.mesh.position.y += Math.sin(p.t * Math.PI) * .5;
    if (p.t >= 1) {
      if (p.payload?.unitId) {
        const target = state.units.find((u) => u.id === p.payload.unitId);
        if (target) { target.hp -= p.payload.damage || 0; target.hitFlash = .18; }
      }
      if (p.payload?.buildingId) {
        const target = state.buildings.find((b) => b.id === p.payload.buildingId);
        if (target) {
          target.hp -= p.payload.damage || 0;
          target.hitFlash = .18;
          if (target.hp <= 0) {
            const center = buildingCenter(state, target);
            spawnCollapse(sceneCtx, center, target.type === 'wall' ? 0x9c9c9c : 0xa06b44);
            if (target.type === 'capital') {
              target.hp = 0;
            } else {
              sceneCtx.groups.buildings.remove(target.mesh);
              target.extraMeshes?.forEach((m) => sceneCtx.groups.decor.remove(m));
              const tile = state.mapIndex.get(target.tileId);
              if (tile) tile.buildingId = null;
              state.units.forEach((u) => {
                if (u.assignedBuildingId === target.id) {
                  u.assignedBuildingId = null;
                  u.awaitingWork = false;
                  u.taskPhase = 'toBuilding';
                }
              });
              state.buildings = state.buildings.filter((b) => b.id !== target.id);
            }
          }
        }
      }
      spawnBurst(sceneCtx, p.to, 0xffc178, 6);
      sceneCtx.groups.effects.remove(p.mesh);
      state.projectiles.splice(i, 1);
    }
  }

  for (let i = sceneCtx.effectBursts.length - 1; i >= 0; i--) {
    const fx = sceneCtx.effectBursts[i];
    fx.life -= dt;
    fx.mesh.position.addScaledVector(fx.vel, dt);
    fx.vel.y -= dt * 4.5;
    fx.mesh.scale.multiplyScalar(0.985);
    if (fx.mesh.material) fx.mesh.material.opacity = Math.max(0, fx.life * 1.6);
    if (fx.life <= 0) {
      sceneCtx.groups.effects.remove(fx.mesh);
      sceneCtx.effectBursts.splice(i, 1);
    }
  }
}
