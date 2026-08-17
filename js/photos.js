// 画像ファイル → Canvasで縮小 → dataURL化。localStorage容量を圧迫しないよう長辺を制限する

const MAX_EDGE = 900;
const JPEG_QUALITY = 0.75;

// 写真が未登録の場所に、実写のサンプル画像を代わりに表示すると「本物のデータが
// 入っている」ように見えて紛らわしい(デモデータ解除後も写真が残って見えるなど)。
// 未登録であることがひと目でわかる、点線枠+アイコンのプレースホルダーを共通で使う。
export function noPhotoPlaceholderHtml(label = '写真未登録', style = '') {
  return `<div class="photo-ph empty" style="${style}"><svg class="icon" viewBox="0 0 24 24"><use href="#i-camera"/></svg><span>${label}</span></div>`;
}

export function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

export function fileToResizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.onload = () => {
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
