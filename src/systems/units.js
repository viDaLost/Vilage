import * as THREE from 'three';
import { UNITS, UNIT_MODEL_MAP } from '../config.js';
import { loadUnitModel } from '../core/assets.js';
import { getCapital, buildingCenter } from './buildings.js';
import { dist2 } from '../utils/helpers.js';
import { spawnCollapse } from './combat.js';

let unitId = 1;

function makeBanner(color) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .9, 5), new THREE.MeshStandardMaterial({ color: 0x5d4326, roughness: 1 }));
  pole.position.set(.22, .65, 0);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.32, .24), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .9 }));
  cloth.position.set(.38, .8, 0);
  return [pole, cloth];
}


function makeUnitMesh(type) {
  const cfg = UNITS[type];
  const friendly = !cfg.hostile;
  const group = new THREE.Group();

  const hiddenBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(.12, .32, 4, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x7ba6ff : 0xbf4c40, roughness: .95, transparent: true, opacity: 0.001 })
  );
  hiddenBody.position.y = 0;
  hiddenBody.castShadow = false;
  hiddenBody.receiveShadow = false;
  group.add(hiddenBody);
  group.userData.body = hiddenBody;

  const fallbackBase = new THREE.Mesh(
    new THREE.CylinderGeometry(.16, .18, .84, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x6f8fc5 : 0x8c3428, roughness: 1, transparent: true, opacity: .18 })
  );
  fallbackBase.position.y = -.02;
  fallbackBase.castShadow = true;
  group.add(fallbackBase);

  const mapping = UNIT_MODEL_MAP[type];
  if (mapping?.file) {
    loadUnitModel(mapping.file).then((model) => {
      model.scale.setScalar(mapping.scale || 0.8);
      model.rotation.y = mapping.rotY || Math.PI;
      model.position.y = mapping.y ?? -0.42;
      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      group.add(model);
      fallbackBase.visible = false;
      group.userData.gltf = model;
    }).catch(() => {});
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.34, .46, 24),
    new THREE.MeshBasicMaterial({ color: cfg.hostile ? 0xff6f61 : 0xffd66b, transparent: true, opacity: .32, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.42;
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
    mesh: makeUnitMesh(type),
    stepPhase: Math.random() * Math.PI * 2,
    attackFlash: 0,
    hitFlash: 0,
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

function nearestTarget(unit, state, predicate, maxDistance = Infinity) {
  let best = null;
  let bestD = Infinity;
  state.units.forEach((candidate) => {
    if (!predicate(candidate)) return;
    const d = dist2(unit.pos, candidate.pos);
    if (d < bestD && d <= maxDistance) {
      best = candidate;
      bestD = d;
    }
  });
  return { best, bestD };
}

function damageNearestBuilding(sceneCtx, state, unit, notify) {
  let nearest = null;
  let nearestD = Infinity;
  state.buildings.forEach((b) => {
    const d = dist2(unit.pos, buildingCenter(state, b));
    if (d < nearestD) {
      nearest = b;
      nearestD = d;
    }
  });
  if (!nearest || nearestD > unit.range + 0.7 || unit.attackCooldown > 0) return;
  nearest.hp -= unit.attack * (unit.type === 'brute' ? 1.5 : 1);
  nearest.hitFlash = .25;
  unit.attackCooldown = unit.type === 'raiderArcher' ? 1.45 : 1.05;
  unit.attackFlash = .16;
  if (nearest.hp <= 0) {
    const center = buildingCenter(state, nearest);
    spawnCollapse(sceneCtx, center, nearest.type === 'wall' ? 0x9c9c9c : 0xa06b44);
    if (nearest.type === 'capital') {
      nearest.hp = 0;
    } else {
      sceneCtx.groups.buildings.remove(nearest.mesh);
      const tile = state.mapIndex.get(nearest.tileId);
      if (tile) tile.buildingId = null;
      state.buildings = state.buildings.filter((b) => b.id !== nearest.id);
      notify(`Разрушено здание: ${nearest.type}`);
    }
  }
}

export function updateUnits(sceneCtx, state, dt, notify) {
  const capital = getCapital(state);
  const capitalTile = capital ? state.mapIndex.get(capital.tileId) : null;
  for (let i = state.units.length - 1; i >= 0; i--) {
    const unit = state.units[i];
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    unit.attackFlash = Math.max(0, unit.attackFlash - dt * 2.2);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt * 3.4);

    let targetPos = null;
    if (unit.hostile) {
      const { best: defender, bestD } = nearestTarget(unit, state, (u) => !u.hostile && u.type !== 'worker', unit.range > 2 ? 8 : 6);
      if (defender) {
        targetPos = defender.pos;
        if (bestD <= unit.range + .35 && unit.attackCooldown <= 0) {
          defender.hp -= unit.attack;
          defender.hitFlash = .18;
          unit.attackCooldown = unit.type === 'raiderArcher' ? 1.45 : 1.15;
          unit.attackFlash = .15;
        }
      } else if (capitalTile) {
        targetPos = capitalTile.pos;
        damageNearestBuilding(sceneCtx, state, unit, notify);
      }
    } else if (unit.type !== 'worker') {
      const { best: enemy, bestD } = nearestTarget(unit, state, (u) => u.hostile, 8);
      if (enemy) {
        targetPos = enemy.pos;
        if (bestD <= unit.range + .35 && unit.attackCooldown <= 0) {
          enemy.hp -= unit.attack;
          enemy.hitFlash = .18;
          unit.attackCooldown = .95;
          unit.attackFlash = .12;
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
        unit.stepPhase += dt * unit.speed * 5;
      }
    }

    unit.mesh.position.set(unit.pos.x, unit.pos.y + .8 + Math.sin(unit.stepPhase || 0) * .03, unit.pos.z);
    const body = unit.mesh.userData.body;
    if (body) {
      body.rotation.z = unit.attackFlash * (unit.hostile ? -0.85 : 0.85);
      body.material.emissive?.setHex(0x000000);
    }
    unit.mesh.scale.setScalar(1 + unit.hitFlash * .12);

    if (unit.hp <= 0) {
      if (unit.hostile) {
        state.resources.prestige += 1.5;
        state.resources.threat = Math.max(0, state.resources.threat - .6);
        state.stats.raidsDefeated += 1;
      }
      spawnCollapse(sceneCtx, unit.pos.clone().add(new THREE.Vector3(0,.5,0)), unit.hostile ? 0xa13d2f : 0xd3c7a5);
      sceneCtx.groups.units.remove(unit.mesh);
      state.units.splice(i, 1);
      continue;
    }

    if (unit.hostile && capitalTile && dist2(unit.pos, capitalTile.pos) < 1.8) {
      state.resources.gold = Math.max(0, state.resources.gold - 4);
      state.resources.food = Math.max(0, state.resources.food - 5);
      state.resources.stability = Math.max(0, state.resources.stability - 1.2);
      unit.hp = 0;
      notify('Налётчик прорвался к столице');
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
