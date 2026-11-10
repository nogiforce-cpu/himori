const { launch, serve } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

(async () => {
  const browser = await launch();
  const results = [], errors = [];
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'docs/review/keyboard');
  fs.mkdirSync(out, { recursive: true });
  const before = fs.mkdtempSync(path.join(os.tmpdir(), 'himori-keyboard-before-'));
  for (const file of ['index.html', 'manifest.json', 'assets', 'css', 'js']) {
    fs.cpSync(path.join(root, file), path.join(before, file), { recursive: true });
  }
  for (const file of ['css/style.css', 'js/app.js', 'js/ui.js']) {
    fs.writeFileSync(path.join(before, file), execFileSync(process.env.GIT_PATH || 'git', ['show', `cdf9192:${file}`], { cwd: root }));
  }

  async function context(width = 393, height = 852) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Tokyo' });
    // Model the iOS case: visual viewport shrinks/pans, layout viewport does not.
    // This is a geometry regression, not an emulation of the native iOS keyboard.
    await ctx.addInitScript(({ width, height }) => {
      const viewport = new EventTarget();
      Object.assign(viewport, { height, width, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
      window.setTestViewport = (height, top = 0) => {
        Object.assign(viewport, { height, offsetTop: top });
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      };
    }, { width, height });
    return ctx;
  }
  const servers = [];
  try {
    for (const [label, directory] of [['before', before], ['after', root]]) {
      const server = await serve(directory); servers.push(server);
      const ctx = await context(); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(server.url + '/?nosw');
      await page.locator('#ob-secondary').click();
      await page.locator('#ob-primary').click();
      await page.locator('#ob-username').fill('薪のある暮らし');
      await page.evaluate(() => window.setTestViewport(440));
      if (label === 'after') await page.waitForFunction(() => document.querySelector('#ob-username').getBoundingClientRect().bottom <= 428);
      const bounds = await page.locator('#ob-username').boundingBox();
      if (label === 'before') assert.ok(bounds.y + bounds.height > 440, 'baseline input hidden by keyboard');
      else assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 440, 'input visible above keyboard');
      await page.evaluate(() => {
        const keyboard = document.createElement('div'); keyboard.id = 'test-keyboard';
        keyboard.style.cssText = 'position:fixed;top:440px;bottom:0;left:0;right:0;z-index:9999;background:#353535;color:#eee;padding:24px;text-align:center;font:16px sans-serif';
        keyboard.textContent = 'キーボード領域（表示範囲の検証用）'; document.body.append(keyboard);
      });
      await page.screenshot({ path: path.join(out, `${label}-name.png`), animations: 'disabled' });
      await page.evaluate(() => document.querySelector('#test-keyboard').remove());
      if (label === 'before') { await ctx.close(); continue; }
      results.push('iPhone相当の表示範囲440pxで名前入力の重なりを再現し解消');
      const visible = async (selector, height = 360, top = 100) => {
        console.log("Checking", selector);
        await page.locator(selector).focus();
        await page.evaluate(({ height, top }) => window.setTestViewport(height, top), { height, top });
        await page.waitForFunction(({ selector, height, top }) => {
          const input = document.querySelector(selector), rect = input.getBoundingClientRect();
          const panel = input.closest('.sheet, .modal'), bounds = panel?.getBoundingClientRect();
          return rect.top >= Math.max(top, bounds?.top ?? top) && rect.bottom <= Math.min(top + height, bounds?.bottom ?? top + height) - 8;
        }, { selector, height, top }).catch(async (error) => {
          console.log(await page.locator(selector).evaluate((el) => {
            const parents = [];
            for (let p = el; p; p = p.parentElement) parents.push({ tag: p.tagName, className: p.className, top: p.getBoundingClientRect().top, height: p.clientHeight, scroll: p.scrollTop, scrollHeight: p.scrollHeight, overflow: getComputedStyle(p).overflowY });
            return { parents, scrollY, visualHeight: visualViewport.height, visualTop: visualViewport.offsetTop };
          }));
          throw error;
        });
        assert.ok(await page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), `${selector}: readable font`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${selector}: no horizontal overflow`);
      };
      await page.locator('#modal-root .input-dismiss').click();
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'ob-username');
      assert.equal(await page.locator('#ob-username').inputValue(), '薪のある暮らし');
      await page.evaluate(() => window.setTestViewport(852));
      await page.locator('#ob-primary').click();
      await page.locator('#ob-stove').fill('わが家の薪ストーブ'); await visible('#ob-stove');
      await page.locator('#modal-root .input-dismiss').click();
      await page.evaluate(() => window.setTestViewport(852));
      await page.locator('#ob-primary').click();
      await visible('#ob-postal-code');
      results.push('ストーブ名・郵便番号・表示範囲の移動にも追従');
      await page.evaluate(async () => {
        const s = await import('/js/store.js'); s.updateProfile({ onboardingCompleted: true });
        s.addShelf({ name: '第一薪棚', totalVolumeM3: 2, usableVolumeM3: 1, remainingPercent: 50 });
      });
      await page.reload();
      const forms = [
        ['openAddShelfSheet', ['#new-shelf-name', '#new-shelf-total', '#new-shelf-drying-date']],
        ['openAddWoodModal', ['#add-date', '#add-woodtype', '#add-source', '#add-price', '#add-memo']],
        ['openStoveEditSheet', ['#stove-edit-name', '#stove-edit-purchase', '#stove-edit-catalyst']],
        ['openMaintenanceSheet', ['#maint-date', '#maint-memo']],
        ['openAddWoodTypeSheet', ['#newwt-name', '#newwt-memo']],
      ];
      for (const [method, selectors] of forms) {
        await page.evaluate(() => window.setTestViewport(852));
        await page.evaluate(async (method) => (await import('/js/render/sheets.js'))[method](), method);
        if (method === 'openAddShelfSheet') await page.locator('#drying-exact-toggle').click();
        if (method === 'openAddWoodTypeSheet') await page.locator('#newwt-toggle-detail').click();
        for (const selector of selectors) await visible(selector);
        if (method === 'openAddWoodModal') await page.screenshot({ path: path.join(out, 'after-add-memo.png'), animations: 'disabled' });
        results.push(`${method}: 入力欄・日付・数字・メモが表示範囲内`);
      }
      await page.evaluate(async () => {
        (await import('/js/ui.js')).closeOverlay(); window.setTestViewport(852);
      });
      await page.locator('#bottomnav [data-tab="check"]').click(); await visible('#check-memo', 400, 0);
      results.push('シート以外の棚チェックのメモもキーボード上へ移動');
      await page.evaluate(async () => {
        const { openEditSheet } = await import('/js/render/sheets.js');
        openEditSheet({ title: '長い入力の確認', fields: Array.from({ length: 10 }, (_, i) => ({ key: `field${i}`, type: 'text', label: `項目${i}`, value: '入力中の文字' })), onSave() {} });
        document.documentElement.setAttribute('data-text-size', 'xlarge');
      });
      await visible('#edit-field9', 320, 0);
      await page.locator('#edit-field9').fill('入力を保持');
      await page.locator('#modal-root .input-dismiss').click();
      await page.evaluate(() => window.setTestViewport(852));
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-keyboard-open'));
      assert.equal(await page.locator('#edit-field9').inputValue(), '入力を保持');
      results.push('長いフォーム・特大文字・入力終了後の復帰と文字保持');
      await page.setViewportSize({ width: 852, height: 393 });
      await visible('#edit-field9', 230, 0);
      results.push('横画面の小さい表示範囲でも末尾の入力欄へ到達');
      await page.setViewportSize({ width: 393, height: 852 });
      await page.evaluate(async () => {
        (await import('/js/ui.js')).closeOverlay(); window.setTestViewport(852);
      });
      await page.locator('#bottomnav [data-tab="home"]').click();
      await page.locator('#btn-open-menu').click();
      await page.locator('#menu-settings').click();
      await page.locator('[data-action="restart-onboarding"]').click();
      await page.locator('#ob-primary').click();
      await page.locator('#ob-username').fill('火のある暮らし');
      await visible('#ob-username', 400, 0);
      assert.equal(await page.evaluate(async () => (await import('/js/store.js')).getShelves().length), 1);
      results.push('設定から初回案内を再表示し、薪棚を残して名前入力を再確認');
      await ctx.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ browser: browser.version(), note: 'VisualViewport geometry simulation, native iOS keyboard not exercised', results, errors }, null, 2));
    console.log(results.join('\n'));
  } finally { await browser.close(); servers.forEach((server) => server.close()); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
