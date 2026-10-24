import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { readPersistedSession, withRecoveryTimeout } from '../src/lib/offlineRecovery';

describe('offline loading recovery', () => {
  test('a stalled request stops waiting instead of loading forever', async () => {
    await assert.rejects(withRecoveryTimeout(new Promise(() => {}), 10), /Connection timeout/);
  });
  test('a successful request returns its actual data', async () => {
    assert.deepEqual(await withRecoveryTimeout(Promise.resolve({ id: 'device-1' }), 10), { id: 'device-1' });
  });
  test('session recovery reads only the requested account key', () => {
    const entries = new Map([['account-a', JSON.stringify({ user: { id: 'user-a' }, access_token: 'test', refresh_token: 'test' })]]);
    const storage = { getItem: (key: string) => entries.get(key) ?? null };
    assert.equal(readPersistedSession(storage, 'account-a')?.user.id, 'user-a');
    assert.equal(readPersistedSession(storage, 'account-b'), null);
  });
  test('corrupt stored data cannot keep initialization loading', () => {
    assert.equal(readPersistedSession({ getItem: () => '{broken' }, 'account'), null);
  });
});