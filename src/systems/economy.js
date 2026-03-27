import { BUILDINGS, GAME_CONFIG, TECHS } from '../config.js';
import { computeBuildingYield } from './buildings.js';
import { clamp, rand } from '../utils/helpers.js';
import { WEATHER_TYPES, ERA_DATA } from '../config.js';

export function applyRealTimeEconomy(state, dt) {
  let income = {
    gold: 0,
    food: 0,
    wood: 0,
    stone: 0,
    prestige: 0,
    stability: 0,
    knowledge: 0,
    populationCap: 0,
    defense: 0,
    army: 0,
  };

  state.buildings.forEach((building) => {
    const y = computeBuildingYield(state, building);
    for (const [key, value] of Object.entries(y)) income[key] = (income[key] || 0) + value;
  });

  const weather = WEATHER_TYPES[state.weather];
  income.food *= weather.food;
  income.gold *= state.techs.has('caravans') ? 1.06 : 1;
  income.knowledge *= state.techs.has('archives') ? 1.05 : 1;
  if (state.techs.has('dynasty')) income.stability += .03;

  state.resources.gold += income.gold * dt;
  state.resources.food += income.food * dt;
  state.resources.wood += income.wood * dt;
  state.resources.stone += income.stone * dt;
  state.resources.prestige += income.prestige * dt;
  state.resources.knowledge += income.knowledge * dt;
  state.resources.stability = clamp(state.resources.stability + income.stability * dt, 0, 100);
  state.resources.army += income.army * dt;

  const capBase = 18 + Math.round(income.populationCap);
  state.resources.populationCap = Math.min(GAME_CONFIG.maxPopulationSoft, capBase);

  const foodDrain = (state.resources.population * 0.045 + state.units.filter((u) => !u.hostile && u.type !== 'worker').length * 0.03) * dt;
  state.resources.food = Math.max(0, state.resources.food - foodDrain);

  if (state.resources.food <= 0.5) state.resources.stability = clamp(state.resources.stability - dt * .75, 0, 100);
  state.resources.threat = clamp(state.resources.threat + dt * (.04 + state.era * .01) - Math.min(0.03, income.defense * .003), 0, 100);
}

export function updateConstruction(state, dt) {
  state.construction.forEach((job) => { job.progress += dt; });
}

export function collectFinishedConstruction(state) {
  const done = state.construction.filter((j) => j.progress >= j.buildTime);
  state.construction = state.construction.filter((j) => j.progress < j.buildTime);
  return done;
}

export function updateEra(state) {
  const capital = state.buildings.find((b) => b.type === 'capital');
  if (!capital) { state.era = 0; return; }
  if (capital.level >= 4 || state.buildings.some((b) => b.type === 'wonder')) state.era = 2;
  else if (capital.level >= 2 || state.buildings.some((b) => b.type === 'academy' || b.type === 'harbor')) state.era = 1;
  else state.era = 0;
}

export function canResearch(state, tech) {
  return !state.techs.has(tech.id) && state.era >= tech.minEra && !state.techProgress;
}

export function beginResearch(state, techId) {
  const tech = TECHS.find((t) => t.id === techId);
  if (!tech) return false;
  if (state.resources.knowledge < tech.cost) return false;
  state.resources.knowledge -= tech.cost;
  state.techProgress = { id: tech.id, progress: 0, duration: 18 + tech.cost * .35 };
  return true;
}

export function updateResearch(state, dt) {
  if (!state.techProgress) return null;
  state.techProgress.progress += dt;
  if (state.techProgress.progress >= state.techProgress.duration) {
    const id = state.techProgress.id;
    state.techs.add(id);
    state.techProgress = null;
    return id;
  }
  return null;
}

export function updateObjectives(state) {
  state.objectives.forEach((obj) => {
    if (obj.done) return;
    let current = 0;
    if (obj.metric === 'food') current = state.resources.food;
    if (obj.metric === 'roads') current = state.resources.roads;
    if (obj.metric === 'armyUnits') current = state.stats.armyUnits;
    if (obj.metric === 'wonderBuilt') current = state.stats.wonderBuilt;
    if (current >= obj.target) {
      obj.done = true;
      for (const [k, v] of Object.entries(obj.reward)) state.resources[k] = (state.resources[k] || 0) + v;
    }
  });
}
