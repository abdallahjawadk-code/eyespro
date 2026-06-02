import type { ReactNode } from 'react';
import '../components/workspace/workspace.css';

export type WorkspaceTab = {
  id: string;
  label: string;
  icon?: string;
  count?: number;
};

export type WorkspaceTabGroup = {
  id: string;
  label?: string;
  tabs: WorkspaceTab[];
};

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: WorkspaceTab[];
  tabGroups?: WorkspaceTabGroup[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
  className?: string;
};

function TabBtn({
  tab,
  activeTab,
  onTabChange,
}: {
  tab: WorkspaceTab;
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab.id}
      className={`ep-tab${activeTab === tab.id ? ' is-active' : ''}`}
      onClick={() => onTabChange(tab.id)}
    >
      {tab.icon && <span aria-hidden>{tab.icon}</span>}
      {tab.label}
      {tab.count != null && tab.count > 0 && (
        <span className="ep-tab-count">{tab.count}</span>
      )}
    </button>
  );
}

/** Domain workspace chrome — hero, tab groups, content panel */
export function Workspace({
  eyebrow,
  title,
  description,
  actions,
  tabs,
  tabGroups,
  activeTab,
  onTabChange,
  children,
  className = '',
}: Props) {
  return (
    <div className={`page-content ep-page ${className}`.trim()}>
      <div className="ep-inner">
        <header className="ep-hero">
          <div>
            {eyebrow && (
              <span className="ep-eyebrow">
                <span className="ep-eyebrow-dot" aria-hidden />
                {eyebrow}
              </span>
            )}
            <h1>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="ep-hero-actions">{actions}</div>}
        </header>

        {tabGroups && tabGroups.length > 0 && activeTab && onTabChange && (
          <nav className="ep-tab-groups" role="tablist">
            {tabGroups.map((group, gi) => (
              <div key={group.id} className="ep-tab-group">
                {group.label && <span className="ep-tab-group-label">{group.label}</span>}
                <div className="ep-tab-group-items">
                  {group.tabs.map((tab) => (
                    <TabBtn key={tab.id} tab={tab} activeTab={activeTab} onTabChange={onTabChange} />
                  ))}
                </div>
                {gi < tabGroups.length - 1 && <span className="ep-tab-group-sep" aria-hidden />}
              </div>
            ))}
          </nav>
        )}

        {!tabGroups?.length && tabs && tabs.length > 0 && activeTab && onTabChange && (
          <nav className="ep-tabs" role="tablist">
            {tabs.map((tab) => (
              <TabBtn key={tab.id} tab={tab} activeTab={activeTab} onTabChange={onTabChange} />
            ))}
          </nav>
        )}

        <div className="ep-panel" role="tabpanel">
          {children}
        </div>
      </div>
    </div>
  );
}
