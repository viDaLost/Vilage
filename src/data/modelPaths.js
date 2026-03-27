export const MODEL_ROOT = './assets/models/buildings/';

export function getModelCandidates(filename) {
  if (!filename) return [];
  const base = `${MODEL_ROOT}${filename}`;
  const named = filename
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const legacy = `${MODEL_ROOT}${named}`;
  return [
    `${base}?v=4`,
    base,
    `${legacy}?v=4`,
    legacy,
  ];
}
