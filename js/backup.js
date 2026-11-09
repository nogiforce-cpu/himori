// Validate the whole backup before touching storage. Optional collections did not
// exist in early releases; omitted ones are restored empty, never merged in.
export function validateBackup(data, keys) {
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const fail = () => { throw new Error('火守のバックアップ形式ではありません'); };
  const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!object(data) || !object(data[keys.profile]) || !Array.isArray(data[keys.shelves])) fail();
  const profile = data[keys.profile];
  if (typeof profile.userName !== 'string' || !object(profile.stove) || typeof profile.stove.name !== 'string') fail();
  const out = {};
  const objectKeys = ['profile', 'woodTypeDetails'];
  const nullable = ['weatherCache'];
  for (const [name, key] of Object.entries(keys)) {
    const value = data[key] ?? (objectKeys.includes(name) ? {} : nullable.includes(name) ? null : []);
    if (objectKeys.includes(name)) { if (!object(value)) fail(); }
    else if (nullable.includes(name)) { if (value !== null && (!object(value) || !Array.isArray(value.daily))) fail(); }
    else if (!Array.isArray(value)) fail();
    out[key] = value;
  }
  for (const name of ['shelves', 'checks', 'burnLogs', 'woodAdditions', 'photos', 'splitLogs', 'maintenanceLogs', 'seasons']) {
    const ids = new Set();
    for (const row of out[keys[name]]) {
      if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) fail();
      ids.add(row.id);
      if (name !== 'shelves' && name !== 'seasons' && !date(row.date)) fail();
      if (['checks', 'burnLogs', 'woodAdditions'].includes(name) && typeof row.shelfId !== 'string') fail();
      if (name === 'shelves') {
        if (typeof row.name !== 'string' || !['乾燥済み', '乾燥中', '来季用'].includes(row.status) ||
          !number(row.totalVolumeM3) || row.totalVolumeM3 === 0 || !number(row.usableVolumeM3) ||
          row.usableVolumeM3 > row.totalVolumeM3 || !number(row.remainingPercent) || row.remainingPercent > 100 ||
          !Array.isArray(row.photoIds) || !row.photoIds.every((v) => typeof v === 'string') ||
          !Array.isArray(row.woodTypes) || !row.woodTypes.every((v) => typeof v === 'string')) fail();
      }
      if (name === 'checks' && (!object(row.items) || !number(row.remainingPercent) || row.remainingPercent > 100 || !number(row.usableVolumeM3))) fail();
      if (name === 'woodAdditions' && !number(row.addedVolumeM3)) fail();
      if (name === 'splitLogs' && row.volumeM3 != null && !number(row.volumeM3)) fail();
      if (name === 'photos' && (typeof row.category !== 'string' || typeof row.uri !== 'string' || !/^(data:image\/(jpeg|png|webp|gif);base64,|assets\/|https:\/\/)/.test(row.uri))) fail();
      if (name === 'maintenanceLogs' && typeof row.type !== 'string') fail();
      if (name === 'seasons' && (!date(row.startDate) || row.endDate != null && (!date(row.endDate) || row.endDate < row.startDate))) fail();
    }
  }
  if (!out[keys.woodTypeCatalog].every((w) => typeof w === 'string')) fail();
  for (const name of ['weatherHistory', 'anshinHistory', 'notificationHistory']) {
    if (!out[keys[name]].every((r) => object(r) && date(r.date))) fail();
  }
  return out;
}
