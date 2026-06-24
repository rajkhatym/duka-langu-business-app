const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const indexHtml = path.join(distDir, 'index.html');

if (!fs.existsSync(indexHtml)) {
  throw new Error('dist/index.html was not found. Run expo export before preparing static routes.');
}

fs.copyFileSync(indexHtml, path.join(distDir, '404.html'));

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    if (entry.name === 'index.html' || entry.name === '404.html') continue;

    const routeDir = fullPath.slice(0, -'.html'.length);
    if (!fs.existsSync(routeDir)) {
      fs.mkdirSync(routeDir, { recursive: true });
    }
    fs.copyFileSync(fullPath, path.join(routeDir, 'index.html'));
  }
}

walk(distDir);
console.log('Prepared static host fallback files.');
