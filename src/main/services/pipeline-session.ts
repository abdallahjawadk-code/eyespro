/** In-memory pipeline UI overrides (per app session, not persisted). */
let sessionDisableAi = false;

export function getPipelineSession(): { disableAi: boolean } {
  return { disableAi: sessionDisableAi };
}

export function setPipelineSessionDisableAi(disable: boolean): void {
  sessionDisableAi = disable;
}

export function isSessionAiDisabled(): boolean {
  return sessionDisableAi;
}
