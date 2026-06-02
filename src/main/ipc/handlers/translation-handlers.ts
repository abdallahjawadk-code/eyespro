import type { IpcMain } from 'electron';
import { sanitizeInt } from '../../security/sanitize';
import { translateText, translateArticle, bulkTranslate } from '../../services/translation';
import type { ApiResult } from '../../../shared/api-types';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** Registered early so translation works even if advanced handlers fail partway. */
export function registerTranslationHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('translation:text', async (_e, text: string, targetLang: string, backend?: string) =>
    ok(await translateText(String(text), String(targetLang), backend as 'google' | 'ai' | undefined))
  );
  ipcMain.handle(
    'translation:article',
    async (_e, articleId: number, targetLang: string, backend?: string, save?: boolean) =>
      ok(await translateArticle(
        sanitizeInt(articleId, 1),
        String(targetLang),
        backend as 'google' | 'ai' | undefined,
        { save: Boolean(save) },
      ))
  );
  ipcMain.handle('translation:bulk', async (_e, ids: number[], targetLang: string, backend?: string) =>
    ok(await bulkTranslate(ids || [], String(targetLang), backend as 'google' | 'ai' | undefined))
  );
}
