import * as THREE from 'three';
import { AnimationMixer, LoopOnce } from 'three';
import { UNITS, UNIT_MODEL_MAP, UNIT_VISUALS } from '../config.js';
import { loadUnitModel } from '../core/assets.js';
import { getCapital, buildingCenter } from './buildings.js';
import { dist2 } from '../utils/helpers.js';
import { spawnCollapse } from './combat.js';

let unitId = 1;

function addWeapon(group, kind, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: .08 });
  if (kind === 'sword' || kind === 'blade' || kind === 'dual') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.05, .42, .05), mat);
    blade.position.set(.18, .12, .12);
    blade.rotation.z = -.45;
    group.add(blade);
    if (kind === 'dual') {
      const blade2 = blade.clone();
      blade2.position.set(-.18, .1, .12);
      blade2.rotation.z = .45;
      group.add(blade2);
    }
  } else if (kind === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.14, .02, 5, 16, Math.PI), mat);
    bow.rotation.z = Math.PI / 2;
    bow.position.set(.18, .1, 0);
    group.add(bow);
  } else if (kind === 'axe') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .5, 5), mat);
    shaft.rotation.z = .55;
    shaft.position.set(.18, .08, .08);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.14, .08, .04), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: .45, metalness: .25 }));
    head.position.set(.28, .2, .08);
    head.rotation.z = .55;
    group.add(shaft, head);
  } else if (kind === 'staff') {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .56, 5), mat);
    staff.rotation.z = -.15;
    staff.position.set(.16, .05, .08);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d07e, emissive: 0xe6b84d, emissiveIntensity: .5 }));
    orb.position.set(.2, .34, .1);
    group.add(staff, orb);
  }
}

function makeSilhouette(type, friendly) {
  const vis = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const body = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({ color: vis.silhouette || (friendly ? 0x738ec7 : 0xa24b40), roughness: .95, transparent: true, opacity: .3 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(type === 'brute' ? .17 : .13, type === 'wolfRider' ? .44 : .34, 4, 8), mainMat);
  torso.position.y = .03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(type === 'brute' ? .12 : .1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d2b8, roughness: 1, transparent: true, opacity: .22 }));
  head.position.y = .34;
  body.add(torso, head);
  addWeapon(body, vis.weapon, vis.ring || 0xffd66b);
  return body;
}

function findClip(animations, keywords, fallbackIndex = 0) {
  if (!animations?.length) return null;
  const lowered = keywords.map((k) => k.toLowerCase());
  let clip = animations.find((a) => lowered.some((k) => (a.name || '').toLowerCase().includes(k)));
  if (!clip) clip = animations[fallbackIndex] || animations[0];
  return clip;
}

function setupMixer(group, model, animations, type) {
  const mixer = new AnimationMixer(model);
  const clips = {
    idle: findClip(animations, ['idle']),
    walk: findClip(animations, ['walk', 'run']),
    attack: findClip(animations, ['attack', 'shoot', 'staff_attack', 'sword_attack', 'dagger_attack', 'spell', 'bow_shoot']),
    hit: findClip(animations, ['recievehit', 'receivehit', 'hit']),
    death: findClip(animations, ['death'])
  };
  const actions = {};
  Object.entries(clips).forEach(([k, clip]) => {
    if (!clip) return;
    const act = mixer.clipAction(clip);
    act.enabled = true;
    act.clampWhenFinished = k === 'attack' || k === 'hit' || k === 'death';
    if (k === 'attack' || k === 'hit' || k === 'death') act.setLoop(LoopOnce, 1);
    actions[k] = act;
  });
  group.userData.mixer = mixer;
  group.userData.animActions = actions;
  group.userData.animState = null;
  setAnimationState(group, type === 'worker' ? 'walk' : 'idle');
}

function setAnimationState(group, next) {
  const actions = group.userData.animActions;
  if (!actions || !actions[next]) return;
  if (group.userData.animState === next) return;
  const prev = actions[group.userData.animState];
  const nextAction = actions[next];
  if (prev && prev !== nextAction) prev.fadeOut(.18);
  nextAction.reset().fadeIn(.18).play();
  group.userData.animState = next;
}

function playOneShot(group, kind, fallback = 'idle') {
  const actions = group.userData.animActions;
  if (!actions?.[kind]) return;
  const action = actions[kind];
  const idle = actions[fallback] || actions.idle;
  action.reset();
  action.play();
  group.userData.animState = kind;
  if (kind !== 'death') {
    setTimeout(() => {
      if (group.userData.animState === kind && idle) {
        setAnimationState(group, fallback);
      }
    }, 420);
  }
}

function makeUnitMesh(type) {
  const cfg = UNITS[type];
  const vis = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const friendly = !cfg.hostile;
  const group = new THREE.Group();

  const hiddenBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(type === 'brute' ? .16 : .12, type === 'wolfRider' ? .42 : .32, 4, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x7ba6ff : 0xbf4c40, roughness: .95, transparent: true, opacity: 0.001 })
  );
  group.add(hiddenBody);
  group.userData.body = hiddenBody;

  const silhouette = makeSilhouette(type, friendly);
  group.add(silhouette);
  group.userData.silhouette = silhouette;

  const fallbackBase = new THREE.Mesh(
    new THREE.CylinderGeometry(type === 'brute' ? .18 : .16, type === 'wolfRider' ? .22 : .18, type === 'wolfRider' ? .95 : .84, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x6f8fc5 : 0x8c3428, roughness: 1, transparent: true, opacity: .16 })
  );
  fallbackBase.position.y = -.02;
  fallbackBase.castShadow = true;
  group.add(fallbackBase);

  const mapping = UNIT_MODEL_MAP[type];
  if (mapping?.file) {
    loadUnitModel(mapping.file).then(({ scene, animations }) => {
      scene.scale.setScalar(mapping.scale || 0.8);
      scene.rotation.y = mapping.rotY || Math.PI;
      scene.position.y = mapping.y ?? -0.42;
      scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      group.add(scene);
      group.userData.gltf = scene;
      fallbackBase.visible = false;
      silhouette.visible = false;
      setupMixer(group, scene, animations, type);
    }).catch(() => {});
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(type === 'brute' ? .42 : .34, type === 'brute' ? .56 : .46, 24),
    new THREE.MeshBasicMaterial({ color: vis.ring || (cfg.hostile ? 0xff6f61 : 0xffd66b), transparent: true, opacity: .34, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.42;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.visual = vis;
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
    healthEl: null,
    dead: false,
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
  playOneShot(unit.mesh, 'attack');
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

function cleanupDeadUnit(sceneCtx, state, unit, index) {
  if (unit.dead) return;
  unit.dead = true;
  spawnCollapse(sceneCtx, unit.pos.clone().setY(unit.pos.y + .6), unit.hostile ? 0xd36d58 : 0x8ebbe0);
  if (unit.mesh.userData.mixer) playOneShot(unit.mesh, 'death', 'idle');
  sceneCtx.groups.units.remove(unit.mesh);
  state.units.splice(index, 1);
  if (!unit.hostile) state.stats.armyUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker').length;
}

export function updateUnits(sceneCtx, state, dt, notify) {
  const capital = getCapital(state);
  const capitalTile = capital ? state.mapIndex.get(capital.tileId) : null;
  for (let i = state.units.length - 1; i >= 0; i--) {
    const unit = state.units[i];
    const vis = UNIT_VISUALS[unit.type] || UNIT_VISUALS.militia;
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    unit.attackFlash = Math.max(0, unit.attackFlash - dt * 2.2);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt * 3.4);

    let targetPos = null;
    let moved = false;
    if (unit.hostile) {
      const { best: defender, bestD } = nearestTarget(unit, state, (u) => !u.hostile && u.type !== 'worker', unit.range > 2 ? 8 : 6);
      if (defender) {
        targetPos = defender.pos;
        if (bestD <= unit.range + .35 && unit.attackCooldown <= 0) {
          defender.hp -= unit.attack;
          defender.hitFlash = .18;
          unit.attackCooldown = unit.type === 'raiderArcher' ? 1.45 : 1.15;
          unit.attackFlash = .15;
          playOneShot(unit.mesh, 'attack');
          if (defender.hp <= 0) cleanupDeadUnit(sceneCtx, state, defender, state.units.indexOf(defender));
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
          playOneShot(unit.mesh, 'attack');
          if (enemy.hp <= 0) cleanupDeadUnit(sceneCtx, state, enemy, state.units.indexOf(enemy));
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
        unit.stepPhase += dt * unit.speed * vis.bobSpeed;
        moved = true;
      }
    }

    unit.mesh.position.set(unit.pos.x, unit.pos.y + .8, unit.pos.z);
    const ringOpacity = unit.hostile ? .38 : .28;
    unit.mesh.userData.ring.material.opacity = ringOpacity + unit.attackFlash * .4 + unit.hitFlash * .3;
    unit.mesh.userData.ring.material.color.setHex(unit.hostile ? 0xff7c63 : 0xffd66b);
    const body = unit.mesh.userData.body;
    if (body) {
      body.position.y = Math.sin(unit.stepPhase) * vis.bounce;
      body.rotation.z = Math.sin(unit.stepPhase * .5) * vis.lean;
      body.material.opacity = .001 + unit.attackFlash * .02 + unit.hitFlash * .04;
    }

    if (unit.mesh.userData.mixer) {
      unit.mesh.userData.mixer.update(dt);
      if (!unit.attackFlash && !unit.hitFlash) {
        setAnimationState(unit.mesh, moved ? 'walk' : 'idle');
      }
    }

    if (unit.hitFlash > 0) {
      if (unit.mesh.userData.gltf) unit.mesh.userData.gltf.scale.multiplyScalar(1 + unit.hitFlash * .01);
      if (unit.mesh.userData.animActions?.hit) playOneShot(unit.mesh, 'hit');
    }

    if (unit.hp <= 0) cleanupDeadUnit(sceneCtx, state, unit, i);
  }
}

export function autoSpawnWorkers(sceneCtx, state, dt, notify) {
  state.workerSpawnTimer += dt;
  const cap = state.resources.populationCap || 18;
  if (state.workerSpawnTimer < state.workerSpawnDelay) return;
  state.workerSpawnTimer = 0;
  if (state.resources.population >= cap) return;
  const capital = getCapital(state);
  if (!capital) return;
  const tile = state.mapIndex.get(capital.tileId);
  if (!tile) return;
  state.resources.population += 1;
  state.resources.workers += 1;
  spawnUnit(sceneCtx, state, 'worker', new THREE.Vector3(tile.pos.x + Math.random(), tile.height, tile.pos.z + Math.random()), null);
  notify('В столицу прибыл новый рабочий');
}
