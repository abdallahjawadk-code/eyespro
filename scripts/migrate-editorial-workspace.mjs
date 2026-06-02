import fs from 'fs';
import path from 'path';

const root = path.resolve('src/renderer/src');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const workspace = path.join(root, 'domains/editorial/workspace');

// Move editorial engine into domain workspace
copyDir(path.join(root, 'features/editorial'), workspace);
copyDir(path.join(root, 'features/pipeline'), path.join(workspace, 'pipeline'));
copyDir(path.join(root, 'features/articles'), path.join(workspace, 'articles'));

// Fix shared/api-types depth in articles/types.ts
const typesPath = path.join(workspace, 'articles/types.ts');
if (fs.existsSync(typesPath)) {
  let t = fs.readFileSync(typesPath, 'utf8');
  t = t.replace(
    "from '../../../../shared/api-types'",
    "from '../../../../../shared/api-types'"
  );
  fs.writeFileSync(typesPath, t);
}

// Fix TranslatePanel import in ContextDock (one level deeper under domains)
const contextDock = path.join(workspace, 'components/ContextDock.tsx');
if (fs.existsSync(contextDock)) {
  let c = fs.readFileSync(contextDock, 'utf8');
  c = c.replace(
    "from '../../../components/translation/TranslatePanel'",
    "from '../../../../components/translation/TranslatePanel'"
  );
  fs.writeFileSync(contextDock, c);
}

console.log('editorial workspace migrated to domains/editorial/workspace/');
