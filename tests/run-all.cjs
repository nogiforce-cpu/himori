const {execFileSync}=require('node:child_process');
for (const args of [['--test','tests/data.test.js'],['tests/browser.cjs'],['tests/edge-browser.cjs'],['tests/pwa.cjs'],['tests/capture-comparison.cjs']]) {
  console.log('\nRunning',args.join(' '));
  execFileSync(process.execPath,args,{stdio:'inherit',env:process.env});
}
