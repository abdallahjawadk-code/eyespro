import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../shell/AppShell';
import { DashboardDomain } from '../domains/dashboard';
import { WelcomeScreen } from '../domains/welcome';

const ArticlesDomain = lazy(() => import('../domains/articles').then((m) => ({ default: m.ArticlesDomain })));
const ContentDomain = lazy(() => import('../domains/content').then((m) => ({ default: m.ContentDomain })));
const AutopilotScreen = lazy(() => import('../domains/editorial/screens/AutopilotScreen').then((m) => ({ default: m.AutopilotScreen })));
const InsightsDomain = lazy(() => import('../domains/insights').then((m) => ({ default: m.InsightsDomain })));
const SystemDomain = lazy(() => import('../domains/system').then((m) => ({ default: m.SystemDomain })));
const SettingsDomain = lazy(() => import('../domains/settings').then((m) => ({ default: m.SettingsDomain })));
const ArticleEditorScreen = lazy(() => import('../domains/articles').then((m) => ({ default: m.ArticleEditorScreen })));
const MonitorDomain = lazy(() => import('../domains/monitor').then((m) => ({ default: m.MonitorDomain })));
const SocialVideoDomain = lazy(() => import('../domains/social-video').then((m) => ({ default: m.SocialVideoDomain })));
const ScheduleDomain = lazy(() => import('../domains/schedule').then((m) => ({ default: m.ScheduleDomain })));

function PageLoader() {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', width: '100%', flexDirection: 'column', gap: 12,
      color: 'var(--t2)', fontSize: 13,
    }}>
      <span style={{ fontSize: 28, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
      {t('common.loading')}
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

/** Application routes — workflow pages in production order */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route element={<AppShell />}>
        <Route path="dashboard" element={<DashboardDomain />} />

        <Route path="content" element={<Lazy><ContentDomain /></Lazy>} />
        <Route path="articles/new" element={<Lazy><ArticleEditorScreen /></Lazy>} />
        <Route path="articles/:id" element={<Lazy><ArticleEditorScreen /></Lazy>} />
        <Route path="articles" element={<Lazy><ArticlesDomain /></Lazy>} />
        <Route path="autopilot" element={<Lazy><AutopilotScreen /></Lazy>} />
        <Route path="schedule" element={<Lazy><ScheduleDomain /></Lazy>} />
        <Route path="sentiment" element={<Navigate to="/articles" replace />} />

        <Route path="insights" element={<Lazy><InsightsDomain /></Lazy>} />
        <Route path="system" element={<Lazy><SystemDomain /></Lazy>} />
        <Route path="settings" element={<Lazy><SettingsDomain /></Lazy>} />
        <Route path="monitor" element={<Lazy><MonitorDomain /></Lazy>} />
        <Route path="social-video" element={<Lazy><SocialVideoDomain /></Lazy>} />
        <Route path="social" element={<Navigate to="/articles" replace />} />

        {/* Legacy redirects */}
        <Route path="video" element={<Navigate to="/articles" replace />} />
        <Route path="publish-video" element={<Navigate to="/articles" replace />} />
        <Route path="broadcast" element={<Navigate to="/articles" replace />} />
        <Route path="newsletter" element={<Navigate to="/articles" replace />} />
        <Route path="editorial-publish" element={<Navigate to="/autopilot" replace />} />
        <Route path="editorial" element={<Navigate to="/autopilot" replace />} />
        <Route path="publish" element={<Navigate to="/articles" replace />} />
        <Route path="production" element={<Navigate to="/articles" replace />} />
        <Route path="pipeline" element={<Navigate to="/articles" replace />} />
        <Route path="ai-batch" element={<Navigate to="/articles" replace />} />
        <Route path="sources" element={<Navigate to="/content?tab=sources" replace />} />
        <Route path="templates" element={<Navigate to="/content?tab=templates" replace />} />
        <Route path="media" element={<Navigate to="/content?tab=media" replace />} />
        <Route path="trends" element={<Navigate to="/content?tab=trends" replace />} />
        <Route path="analytics" element={<Navigate to="/insights?tab=analytics" replace />} />
        <Route path="quality" element={<Navigate to="/insights?tab=quality" replace />} />
        <Route path="reports" element={<Navigate to="/insights?tab=reports" replace />} />
        <Route path="link-scan" element={<Navigate to="/insights?tab=links" replace />} />
        <Route path="keywords" element={<Navigate to="/insights?tab=keywords" replace />} />
        <Route path="health" element={<Navigate to="/insights?tab=health" replace />} />
        <Route path="publish-tracker" element={<Navigate to="/insights?tab=tracker" replace />} />
        <Route path="calendar" element={<Navigate to="/schedule?tab=calendar" replace />} />
        <Route path="scheduler" element={<Navigate to="/schedule?tab=scheduler" replace />} />
        <Route path="kanban" element={<Navigate to="/articles" replace />} />
        <Route path="publish-articles" element={<Navigate to="/articles" replace />} />
      </Route>
    </Routes>
  );
}
