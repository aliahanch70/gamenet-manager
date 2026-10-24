import { describe, expect, test } from 'bun:test';
import { readPersistedSession, withRecoveryTimeout } from './offlineRecovery';

describe('offline loading recovery', () => {
  test('a stalled request stops waiting instead of loading forever', async () => {
    await expect(withRecoveryTimeout(new Promise(() => {}), 10)).rejects.toThrow('Connection timeout');
  });
  test('a successful request returns its actual data', async () => {
    expect(await withRecoveryTimeout(Promise.resolve({ id: 'device-1' }), 10)).toEqual({ id: 'device-1' });
  });
  test('session recovery reads only the requested account key', () => {
    const entries = new Map([['account-a', JSON.stringify({ user: { id: 'user-a' }, access_token: 'test', refresh_token: 'test' })]]);
    const storage = { getItem: (key: string) => entries.get(key) ?? null };
    expect(readPersistedSession(storage, 'account-a')?.user.id).toBe('user-a');
    expect(readPersistedSession(storage, 'account-b')).toBeNull();
  });
  test('corrupt stored data cannot keep initialization loading', () => {
    expect(readPersistedSession({ getItem: () => '{broken' }, 'account')).toBeNull();
  });
});