import fs from 'fs';
import path from 'path';

const root = path.resolve('src/renderer/src');
const map = {
  'views/dashboard/DashboardView.tsx': 'domains/dashboard/screens/DashboardScreen.tsx',
  'views/editorial/ProductionView.tsx': 'domains/editorial/screens/ProductionScreen.tsx',
  'views/editorial/KanbanView.tsx': 'domains/editorial/screens/KanbanScreen.tsx',
  'views/editorial/StudioView.tsx': 'domains/editorial/screens/StudioScreen.tsx',
  'views/editorial/PublishNowView.tsx': 'domains/editorial/screens/PublishNowScreen.tsx',
  'views/editorial/VideoView.tsx': 'domains/editorial/screens/VideoScreen.tsx',
  'views/editorial/LiveView.tsx': 'domains/editorial/screens/LiveScreen.tsx',
  'views/editorial/CalendarView.tsx': 'domains/editorial/screens/CalendarScreen.tsx',
  'views/editorial/SchedulerView.tsx': 'domains/editorial/screens/SchedulerScreen.tsx',
  'views/content/SourcesView.tsx': 'domains/content/screens/SourcesScreen.tsx',
  'views/content/TemplatesView.tsx': 'domains/content/screens/TemplatesScreen.tsx',
  'views/content/MediaView.tsx': 'domains/content/screens/MediaScreen.tsx',
  'views/content/TrendsView.tsx': 'domains/content/screens/TrendsScreen.tsx',
  'views/insights/AnalyticsView.tsx': 'domains/insights/screens/AnalyticsScreen.tsx',
  'views/insights/QualityView.tsx': 'domains/insights/screens/QualityScreen.tsx',
  'views/insights/ReportsView.tsx': 'domains/insights/screens/ReportsScreen.tsx',
  'views/insights/HealthView.tsx': 'domains/insights/screens/HealthScreen.tsx',
  'views/insights/TrackerView.tsx': 'domains/insights/screens/TrackerScreen.tsx',
  'views/insights/LinksView.tsx': 'domains/insights/screens/LinksScreen.tsx',
  'views/insights/KeywordsView.tsx': 'domains/insights/screens/KeywordsScreen.tsx',
  'views/system/MonitorView.tsx': 'domains/system/screens/MonitorScreen.tsx',
  'views/system/UsersView.tsx': 'domains/system/screens/UsersScreen.tsx',
  'views/system/AuditView.tsx': 'domains/system/screens/AuditScreen.tsx',
  'views/settings/SettingsView.tsx': 'domains/settings/screens/SettingsScreen.tsx',
  'views/articles/ArticleEditorView.tsx': 'domains/articles/screens/ArticleEditorScreen.tsx',
  'pages/WelcomePage.tsx': 'domains/welcome/WelcomeScreen.tsx',
};

function fix(src) {
  return src
    .replace(/from '\.\.\/\.\.\/ui'/g, "from '../../../ui'")
    .replace(/from '\.\.\/\.\.\/\.\.\/shared/g, "from '../../../../shared")
    .replace(/from '\.\.\/\.\.\/features/g, "from '../../../features")
    .replace(/from '\.\.\/\.\.\/components/g, "from '../../../components")
    .replace(/from '\.\.\/\.\.\/hooks/g, "from '../../../hooks")
    .replace(/from '\.\.\/context/g, "from '../../context")
    .replace(/from '\.\.\/ui'/g, "from '../../ui'")
    .replace(/export function (\w+)View\b/g, 'export function $1Screen')
    .replace(/export function WelcomePage\b/g, 'export function WelcomeScreen');
}

let n = 0;
for (const [from, to] of Object.entries(map)) {
  const srcPath = path.join(root, from);
  const dstPath = path.join(root, to);
  if (!fs.existsSync(srcPath)) {
    console.log('MISSING', from);
    continue;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, fix(fs.readFileSync(srcPath, 'utf8')));
  n++;
}
console.log('migrated', n, 'files');
