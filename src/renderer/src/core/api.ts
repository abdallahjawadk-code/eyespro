import type { EyesProApi } from '../../../shared/api-types';

/** Typed access to the preload bridge — single entry for renderer → main IPC */
export function api(): EyesProApi {
  if (!window.eyespro) throw new Error('EyesPro bridge not available');
  return window.eyespro;
}

export type { EyesProApi, ApiResult } from '../../../shared/api-types';
