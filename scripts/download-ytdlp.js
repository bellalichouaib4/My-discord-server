/**
 * Downloads yt-dlp binary after npm install.
 * DisTube's YtDlpPlugin looks for the binary in node_modules/@distube/yt-dlp/bin/
 */
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const isWin = os.platform() === 'win32';
const BIN_DIR  = path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'bin');
const BIN_NAME = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const URL      = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

if (fs.existsSync(BIN_PATH)) {
  console.log('[yt-dlp] Binary already present, skipping download.');
  process.exit(0);
}

fs.mkdirSync(BIN_DIR, { recursive: true });
console.log('[yt-dlp] Downloading binary...');

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      file.close();
      fs.unlinkSync(dest);
      return download(res.headers.location, dest, cb);
    }
    res.pipe(file);
    file.on('finish', () => file.close(cb));
  }).on('error', (e) => {
    fs.unlink(dest, () => {});
    console.error('[yt-dlp] Download error:', e.message);
    process.exit(1);
  });
}

download(URL, BIN_PATH, () => {
  if (!isWin) fs.chmodSync(BIN_PATH, 0o755);
  console.log('[yt-dlp] Binary downloaded to', BIN_PATH);
});
