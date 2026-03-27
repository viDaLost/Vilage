import * as THREE from 'three';
import { TERRAIN_TYPES } from '../config.js';
import { createHexShape, getNeighbors, isTileInsideTerritory } from './world.js';

const terrainMaterials = new Map();

function getTerrainMaterial(type) {
  if (terrainMaterials.has(type)) return terrainMaterials.get(type);
  const mat = new THREE.MeshStandardMaterial({
    color: TERRAIN_TYPES[type].color,
    roughness: type === 'river' || type === 'water' ? .25 : .92,
    metalness: type === 'water' ? .08 : 0
  });
  terrainMaterials.set(type, mat);
  return mat;
}

function addTreeCluster(group, pos, y) {
  const matTrunk = new THREE.MeshStandardMaterial({ color: 0x714a24, roughness: 1 });
  const matLeaf = new THREE.MeshStandardMaterial({ color: 0x2e6f2c, roughness: 1 });
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .7, 5), matTrunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(.36 + Math.random() * .14, .9, 7), matLeaf);
    const ox = (Math.random() - .5) * 1.4;
    const oz = (Math.random() - .5) * 1.4;
    trunk.position.set(pos.x + ox, y + .36, pos.z + oz);
    crown.position.set(pos.x + ox, y + .96, pos.z + oz);
    trunk.castShadow = crown.castShadow = true;
    group.add(trunk, crown);
  }
}

function addRockCluster(group, pos, y) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x929292, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.22 + Math.random() * .12, 0), mat);
    rock.position.set(pos.x + (Math.random() - .5) * 1.2, y + .16 + Math.random() * .2, pos.z + (Math.random() - .5) * 1.2);
    rock.scale.setScalar(.8 + Math.random() * 1.1);
    rock.castShadow = true;
    group.add(rock);
  }
}

function addGrassCluster(group, pos, y) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xc4c15f, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(.015, .03, .35 + Math.random() * .15, 4), mat);
    blade.position.set(pos.x + (Math.random() - .5) * 1.5, y + .16, pos.z + (Math.random() - .5) * 1.5);
    group.add(blade);
  }
}

export function renderTiles(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.tiles.clear();
  groups.decor.clear();
  groups.overlays.clear();

  const shape = createHexShape();
  const ringGeo = new THREE.RingGeometry(state.territoryRadius - .12, state.territoryRadius + .12, 120);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .15, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .06;
  groups.overlays.add(ring);

  state.map.forEach((tile) => {
    const depth = tile.type === 'water' ? .44 : .58 + Math.max(0, tile.height * .05);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(tile.pos.x, tile.height - depth, tile.pos.z);
    const mesh = new THREE.Mesh(geo, getTerrainMaterial(tile.type));
    mesh.receiveShadow = true;
    mesh.userData.tileId = tile.id;
    groups.tiles.add(mesh);
    tile.mesh = mesh;

    if (tile.type === 'forest') addTreeCluster(groups.decor, tile.pos, tile.height + .02);
    if (tile.type === 'rock' || tile.type === 'hill') addRockCluster(groups.decor, tile.pos, tile.height + .02);
    if (tile.type === 'fertile' || tile.type === 'grass') addGrassCluster(groups.decor, tile.pos, tile.height + .02);

    if (isTileInsideTerritory(state, tile) && tile.type !== 'water') {
      const borderGeo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1.64, 1.64, .03, 6));
      const line = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .04 }));
      line.rotation.y = Math.PI / 6;
      line.position.set(tile.pos.x, tile.height + .07, tile.pos.z);
      groups.overlays.add(line);
    }
  });
}

export function renderRoads(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.roads.clear();
  const roadMat = new THREE.LineBasicMaterial({ color: 0xcba56a, transparent: true, opacity: .7 });
  state.roads.forEach((road) => {
    const a = state.mapIndex.get(road.a);
    const b = state.mapIndex.get(road.b);
    if (!a || !b) return;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.pos.x, a.height + .12, a.pos.z),
      new THREE.Vector3(b.pos.x, b.height + .12, b.pos.z)
    ]);
    groups.roads.add(new THREE.Line(geo, roadMat));
  });
}
