import type { IpcMain, BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { sanitizeInt } from '../../security/sanitize';
import * as articles from '../../services/articles';
import { checkDuplicate } from '../../services/ingest';
import { generateDocx, type DocxGroupBy } from '../../services/docx-export';
function ok<T>(data: T): { ok: true; data: T } { return { ok: true, data }; }

function ipcBytesToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  const bufLike = data as { type?: string; data?: number[] };
  if (bufLike?.type === 'Buffer' && Array.isArray(bufLike.data)) return Buffer.from(bufLike.data);
  throw new Error('Invalid document data');
}

export function registerArticlesHandlers(ipcMain: IpcMain, getWin: () => BrowserWindow | null): void {
  // ── pageInit: replaces 7 separate IPC calls at page open ─────────────────
  ipcMain.handle('articles:pageInit', () => {
    const init = articles.articlesPageInit();
    return ok(init);
  });

  ipcMain.handle('articles:list',   (_e, opts?) => ok(articles.listArticles(opts)));
  ipcMain.handle('articles:count',  (_e, opts?) => ok(articles.countArticles(opts)));
  ipcMain.handle('articles:search', (_e, q: string, limit?: number) => ok(articles.searchArticles(String(q), limit)));
  ipcMain.handle('articles:categories', () => ok(articles.listCategories()));
  ipcMain.handle('articles:get',    (_e, id: number) => ok(articles.getArticle(sanitizeInt(id, 1))));
  ipcMain.handle('articles:create', (_e, data) => ok({ id: articles.createArticle(data || {}) }));
  ipcMain.handle('articles:update', (_e, id: number, data) => {
    const r = articles.updateArticle(sanitizeInt(id, 1), data || {});
    return r ? ok(undefined) : { ok: false, error: 'Not found', code: 'NOT_FOUND' };
  });
  ipcMain.handle('articles:delete', (_e, id: number) => {
    articles.deleteArticle(sanitizeInt(id, 1));
    return ok(undefined);
  });
  ipcMain.handle('articles:bulkDelete', (_e, ids: number[]) => {
    const safeIds = (Array.isArray(ids) ? ids : []).slice(0, 500).map((id) => sanitizeInt(id, 1));
    return ok({ deleted: articles.bulkDeleteArticles(safeIds) });
  });
  ipcMain.handle('articles:deleteAll', () => {
    return ok({ deleted: articles.deleteAllArticles() });
  });
  ipcMain.handle('articles:checkDuplicate', (_e, link: string) =>
    ok({ duplicate: checkDuplicate(String(link || '').trim()) })
  );
  ipcMain.handle('articles:saveDocxFile', async (_e, filename: string, data: unknown) => {
    try {
      const { shell } = await import('electron');
      const fs = await import('fs');
      const safeFilename = String(filename || 'article').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
      const w = getWin();
      const opts = { defaultPath: `${safeFilename}.docx`, filters: [{ name: 'Word Document', extensions: ['docx'] }] };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
      fs.writeFileSync(r.filePath, ipcBytesToBuffer(data));
      void shell.openPath(r.filePath);
      return ok(r.filePath);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('articles:downloadDocx', async (
    _e,
    articleIds: unknown,
    opts?: { groupBy?: string; title?: string; toDesktop?: boolean }
  ) => {
    try {
      const { shell, app } = await import('electron');
      const fs = await import('fs');
      const path = await import('path');

      const ids = Array.isArray(articleIds)
        ? articleIds.map((id) => sanitizeInt(Number(id), 1)).filter((id) => id > 0).slice(0, 500)
        : [];

      if (!ids.length) return { ok: false, error: 'لم يتم تحديد أي مقالات' };

      const articleList = ids.map((id) => articles.getArticle(id)).filter(Boolean) as ReturnType<typeof articles.getArticle>[];
      if (!articleList.length) return { ok: false, error: 'لم يتم العثور على المقالات' };

      const validGroupBy = ['source', 'category', 'status', 'none'].includes(opts?.groupBy ?? '')
        ? (opts?.groupBy as DocxGroupBy)
        : 'source';

      const buffer = await generateDocx(articleList as Parameters<typeof generateDocx>[0], {
        groupBy: validGroupBy,
        title: opts?.title ? String(opts.title).slice(0, 200) : undefined,
      });

      const timestamp = new Date().toISOString().slice(0, 10);
      const safeTitle = (opts?.title ?? 'مقالات').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
      const filename = `EyesPro_${safeTitle}_${timestamp}.docx`;

      let savePath: string;
      if (opts?.toDesktop) {
        savePath = path.join(app.getPath('desktop'), filename);
        fs.writeFileSync(savePath, buffer);
      } else {
        const w = getWin();
        const dialogOpts = { defaultPath: filename, filters: [{ name: 'Word Document', extensions: ['docx'] }] };
        const r = w ? await dialog.showSaveDialog(w, dialogOpts) : await dialog.showSaveDialog(dialogOpts);
        if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
        savePath = r.filePath;
        fs.writeFileSync(savePath, buffer);
      }

      void shell.openPath(savePath);
      return ok({ filePath: savePath, count: articleList.length });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
