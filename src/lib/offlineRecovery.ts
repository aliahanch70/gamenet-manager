import type { Session } from '@supabase/supabase-js';

export const RECOVERY_TIMEOUT_MS = 6000;

export async function withRecoveryTimeout<T>(request: PromiseLike<T>, timeoutMs = RECOVERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Only restores the SDK's last session for offline display; never grants roles.
export function readPersistedSession(storage: Pick<Storage, 'getItem'>, key: string): Session | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.user?.id || typeof session.user.id !== 'string' ||
        typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') return null;
    return session as Session;
  } catch {
    return null;
  }
}