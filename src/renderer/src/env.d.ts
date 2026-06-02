/// <reference types="vite/client" />
import type { EyesProApi } from '../../shared/api-types';

export type { EyesProApi };

declare global {
  interface Window {
    eyespro: EyesProApi;
  }
}
