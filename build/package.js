// Builds Bubblist.app for this Mac's architecture into dist/.
//   node build/package.js            build only
//   node build/package.js --install  build, copy to /Applications, and launch
const { packager } = require('@electron/packager');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

async function main() {
  const [outDir] = await packager({
    dir: root,
    name: 'Bubblist',
    platform: 'darwin',
    arch: process.arch,
    icon: path.join(__dirname, 'icon.icns'),
    extendInfo: path.join(__dirname, 'extra.plist'),
    appBundleId: 'io.github.bubblist',
    out: path.join(root, 'dist'),
    overwrite: true,
    ignore: [/^\/dist/, /^\/build/, /^\/docs/, /^\/\.github/],
  });
  const appPath = path.join(outDir, 'Bubblist.app');

  // VS Code terminals set ELECTRON_RUN_AS_NODE, which would make the app start
  // as plain Node; turn that switch off in the binary.
  await flipFuses(appPath, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false });

  // Ad-hoc signature so Apple Silicon will run the modified bundle.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`Built ${path.relative(root, appPath)}`);

  if (process.argv.includes('--install')) {
    const target = '/Applications/Bubblist.app';
    try { execFileSync('pkill', ['-f', 'Bubblist.app/Contents/MacOS']); } catch {}
    execFileSync('rm', ['-rf', target]);
    execFileSync('ditto', [appPath, target]);
    execFileSync('open', [target]);
    console.log(`Installed to ${target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
