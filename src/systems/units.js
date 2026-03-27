import * as THREE from 'three';
import { UNITS, BUILDINGS } from '../config.js';
import { getCapital } from './buildings.js';
import { dist2 } from '../utils/helpers.js';

let unitId = 1;

function unitMaterial(type) {
  const hostile = UNITS[type].hostile;
  return new THREE.MeshStandardMaterial({
    color: hostile ? 0xb64030 : 0xd9c07d,
    roughness: .8,
    metalness: .06
  });
}

function unitMesh(type) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .7, 5, 8), unitMaterial(type));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.34, .46, 24),
    new THREE.MeshBasicMaterial({ color: UNITS[type].hostile ? 0xff6f61 : 0xffd66b, transparent: true, opacity: .3, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.46;
  group.add(ring);
  return group;
}

export function spawnUnit(sceneCtx, state, type, pos, target = null) {
  const cfg = UNITS[type];
  const entity = {
    id: `u-${unitId++}`,
    type,
    hp: cfg.hp,
    maxHp: cfg.hp,
    speed: cfg.speed,
    attack: cfg.attack,
    range: cfg.range,
    hostile: !!cfg.hostile,
    attackCooldown: 0,
    pos: new THREE.Vector3(pos.x, pos.y, pos.z),
    target,
    mode: target ? 'move' : 'idle',
    mesh: unitMesh(type)
  };
  entity.mesh.position.copy(entity.pos);
  entity.mesh.position.y += .8;
  sceneCtx.groups.units.add(entity.mesh);
  state.units.push(entity);
  if (!entity.hostile) state.stats.armyUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker').length;
  return entity;
}

export function queueTraining(building, type) {
  const cfg = UNITS[type];
  building.trainQueue.push({ type, progress: 0, trainTime: cfg.trainTime });
}

export function updateTraining(sceneCtx, state, dt, notify) {
  for (const building of state.buildings) {
    if (!building.trainQueue.length) continue;
    const current = building.trainQueue[0];
    current.progress += dt;
    if (current.progress >= current.trainTime) {
      const tile = state.mapIndex.get(building.tileId);
      const spawnPos = new THREE.Vector3(tile.pos.x + .8, tile.height, tile.pos.z + .8);
      const target = current.type === 'worker' ? null : getCapital(state) ? state.mapIndex.get(getCapital(state).tileId).pos.clone() : null;
      spawnUnit(sceneCtx, state, current.type, spawnPos, target);
      building.trainQueue.shift();
      notify(`${UNITS[current.type].name} готов`);
    }
  }
}

export function updateUnits(sceneCtx, state, dt, notify) {
  const capital = getCapital(state);
  const capitalTile = capital ? state.mapIndex.get(capital.tileId) : null;
  for (let i = state.units.length - 1; i >= 0; i--) {
    const unit = state.units[i];
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);

    let targetPos = null;
    if (unit.hostile) {
      const defenders = state.units.filter((u) => !u.hostile && u.type !== 'worker');
      let nearestDef = null;
      let nearestD = Infinity;
      defenders.forEach((d) => {
        const d2 = dist2(unit.pos, d.pos);
        if (d2 < nearestD) { nearestD = d2; nearestDef = d; }
      });
      if (nearestDef && nearestD < 5) {
        targetPos = nearestDef.pos;
        if (nearestD <= unit.range + .35 && unit.attackCooldown <= 0) {
          nearestDef.hp -= unit.attack;
          unit.attackCooldown = 1.15;
        }
      } else if (capitalTile) {
        targetPos = capitalTile.pos;
      }
    } else if (unit.type !== 'worker') {
      const hostiles = state.units.filter((u) => u.hostile);
      let targetEnemy = null;
      let bestD = Infinity;
      hostiles.forEach((h) => {
        const d = dist2(unit.pos, h.pos);
        if (d < bestD) { bestD = d; targetEnemy = h; }
      });
      if (targetEnemy && bestD < 7) {
        targetPos = targetEnemy.pos;
        if (bestD <= unit.range + .35 && unit.attackCooldown <= 0) {
          targetEnemy.hp -= unit.attack;
          unit.attackCooldown = .95;
        }
      } else if (capitalTile) {
        targetPos = capitalTile.pos;
      }
    }

    if (targetPos) {
      const dir = new THREE.Vector3().subVectors(targetPos, unit.pos);
      dir.y = 0;
      const len = dir.length();
      if (len > .18) {
        dir.normalize();
        unit.pos.addScaledVector(dir, unit.speed * dt);
        unit.mesh.lookAt(unit.pos.x + dir.x, unit.mesh.position.y, unit.pos.z + dir.z);
      }
    }

    unit.mesh.position.set(unit.pos.x, unit.pos.y + .8, unit.pos.z);

    if (unit.hp <= 0) {
      if (unit.hostile) {
        state.resources.prestige += 1.5;
        state.resources.threat = Math.max(0, state.resources.threat - .6);
        state.stats.raidsDefeated += 1;
      }
      sceneCtx.groups.units.remove(unit.mesh);
      state.units.splice(i, 1);
      continue;
    }

    if (unit.hostile && capitalTile && dist2(unit.pos, capitalTile.pos) < 1.6) {
      state.resources.gold = Math.max(0, state.resources.gold - 4);
      state.resources.food = Math.max(0, state.resources.food - 5);
      state.resources.stability = Math.max(0, state.resources.stability - 1.2);
      unit.hp = 0;
      notify('Налётчик достиг столицы');
    }
  }
  state.stats.armyUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker').length;
}

export function autoSpawnWorkers(sceneCtx, state, notify) {
  if (state.resources.workers >= state.resources.population) return;
  if (state.resources.population >= state.resources.populationCap) return;
  const capital = getCapital(state);
  if (!capital) return;
  const tile = state.mapIndex.get(capital.tileId);
  spawnUnit(sceneCtx, state, 'worker', new THREE.Vector3(tile.pos.x + .5, tile.height, tile.pos.z - .4));
  state.resources.workers += 1;
  state.resources.population += 1;
  notify('В столице появился новый рабочий');
}
