import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Empty, Loading, Panel, Toolbar } from '../../../ui';

type Task = { id: number; name?: string; status: string; next_run?: string; cron?: string };

export function SchedulerScreen() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.tasks.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) setTasks(res.data as Task[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runTask(id: number) {
    await window.eyespro.tasks.run(id);
    void load();
  }

  return (
    <Panel>
      <Toolbar><Btn onClick={() => void load()}>↻ {t('common.refresh')}</Btn></Toolbar>
      <Card title={t('editorialPublishHub.tabs.scheduler')}>
        {loading ? <Loading /> : tasks.length === 0 ? (
          <Empty title={t('scheduler.empty', { defaultValue: 'لا مهام مجدولة' })} icon="⏰" />
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr><th>#</th><th>{t('scheduler.name', { defaultValue: 'المهمة' })}</th><th>{t('articles.colStatus')}</th><th>{t('scheduler.next', { defaultValue: 'التالي' })}</th><th></th></tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.id}</td>
                    <td>{task.name ?? task.cron ?? '—'}</td>
                    <td><Badge tone={task.status === 'active' ? 'ok' : 'muted'}>{task.status}</Badge></td>
                    <td>{task.next_run ? new Date(task.next_run).toLocaleString() : '—'}</td>
                    <td><Btn size="sm" onClick={() => void runTask(task.id)}>{t('scheduler.run', { defaultValue: 'تشغيل' })}</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Panel>
  );
}
