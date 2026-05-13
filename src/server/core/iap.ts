import { settings } from '@devvit/web/server';

export type ConflictGateStatus = {
  enabled: boolean;
  hasAccess: boolean;
  sku?: string;
};

export async function getConflictGateStatus(): Promise<ConflictGateStatus> {
  const enabled = (await settings.get<boolean>('iapConflictEnabled')) ?? false;
  const sku = (await settings.get<string>('conflictIapSku'))?.trim();

  if (!enabled) {
    return { enabled: false, hasAccess: true, ...(sku ? { sku } : {}) };
  }

  return {
    enabled: true,
    hasAccess: false,
    ...(sku ? { sku } : {}),
  };
}
