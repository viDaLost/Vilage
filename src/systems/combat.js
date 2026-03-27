import * as THREE from 'three';
import { nearestDefense, buildingCenter } from './buildings.js';
import { dist2 } from '../utils/helpers.js';

let projectileId = 1;

function spawnProjectile(sceneCtx, from, to) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(.08, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd88a })
  );
  mesh.position.copy(from);
  sceneCtx.groups.effects.add(mesh);
  return { id: `p-${projectileId++}`, from: from.clone(), to: to.clone(), t: 0, mesh };
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
      best.hp -= building.type === 'tower' ? 9 : 5;
      building.cooldown = building.type === 'tower' ? 1.2 : 1.7;
      state.projectiles.push(spawnProjectile(sceneCtx, center.clone().add(new THREE.Vector3(0, 1.1, 0)), best.pos.clone().add(new THREE.Vector3(0, .8, 0))));
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
      sceneCtx.groups.effects.remove(p.mesh);
      state.projectiles.splice(i, 1);
    }
  }
}
