const { execFileSync } = require('node:child_process');
for (const args of [
  ['--test', 'tests/data.test.js', 'tests/calendar-data.test.js'],
  ['tests/calendar.cjs'],
  ['tests/browser.cjs'],
  ['tests/keyboard.cjs'],
  ['tests/edge-browser.cjs'],
  ['tests/pwa.cjs'],
]) {
  console.log('\nRunning', args.join(' '));
  execFileSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, HIMORI_QA_DIR: 'docs/review/calendar', HIMORI_KEYBOARD_QA_DIR: 'docs/review/calendar/keyboard' } });
}
