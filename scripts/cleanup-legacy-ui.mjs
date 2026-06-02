import fs from 'fs';
import path from 'path';

const root = path.resolve('src/renderer/src');

const removePaths = [
  'views',
  'pages',
  'components/settings',
  'features/editorial',
  'features/pipeline',
  'features/articles',
  'features/dashboard',
  'features/system-hub',
  'features/sources',
  'features/content-hub',
  'features/insights-hub',
  'features/editorial-publish-hub',
  'features/publish-hub',
];

function rm(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) {
    console.log('skip (missing)', p);
    return;
  }
  fs.rmSync(full, { recursive: true, force: true });
  console.log('removed', p);
}

for (const p of removePaths) rm(p);
