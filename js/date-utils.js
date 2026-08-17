// 日付を 'YYYY-MM-DD' 文字列にする共通ヘルパー。
// Date#toISOString() はUTCに変換するため、日本時間(UTC+9)では深夜0時〜朝9時台に
// 日付が1日ずれてしまう(例: 11/30 0時のつもりがUTC変換で11/29になる)。
// 必ずこの関数経由でローカルの年月日をそのまま文字列化し、ズレを防ぐ。
export function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
