// 「火のある場所」(薪ストーブが設置されている場所)を郵便番号から特定するモジュール。
// 郵便番号はあくまで住所入力を楽にする手段であり、気象情報の地点そのものではない
// (内部的には解決後の緯度経度・気象庁発表区分だけを使う)。
// 既存のresolveLocationFromCity(都道府県/市区町村選択)と同じ形の{lat,lon,prefecture,
// city,jma}を返すことで、weather.js/jma.js側は無改修のまま動く。
import { resolveJmaArea } from './jma.js';

function normalizePostal(input) {
  return (input || '').replace(/[^0-9]/g, '');
}

// 郵便番号から住所候補(町域単位、複数件のことがある)を取得する。
// HeartRails Geo API(https://geoapi.heartrails.com/)を使用。既にweather.jsの
// 都道府県/市区町村選択で利用しているのと同じ無料APIで、新規のサービス導入にはならない。
// (利用規約に商用利用条件・料金の明記は見当たらなかったため、一般公開の可否は
// 別途ユーザー側での確認が必要— 完了報告に明記する)
export async function lookupAddressCandidates(postalCode) {
  const postal = normalizePostal(postalCode);
  if (postal.length !== 7) throw new Error('郵便番号は7桁で入力してください');
  const url = `https://geoapi.heartrails.com/api/json?method=searchByPostal&postal=${postal}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('住所の取得に失敗しました');
  const data = await res.json();
  const list = data?.response?.location;
  if (!list || !list.length) throw new Error('該当する住所が見つかりませんでした');
  return list.map((l) => ({
    prefecture: l.prefecture,
    city: l.city,
    town: l.town,
    lat: Number(l.y),
    lon: Number(l.x),
    postal,
  }));
}

// 選ばれた住所候補を「火のある場所」として確定する。気象庁の発表区分(office/class10/
// class15/class20)も同時に解決し、既存の地点予報取得コードがそのまま使える形にする。
export async function resolveFireSite(candidate) {
  const jma = await resolveJmaArea({
    prefecture: candidate.prefecture,
    city: candidate.city,
    town: candidate.town,
  }).catch(() => null);
  return {
    lat: candidate.lat,
    lon: candidate.lon,
    prefecture: candidate.prefecture,
    city: candidate.city,
    town: candidate.town,
    postalCode: candidate.postal,
    source: 'postal',
    jma,
  };
}
