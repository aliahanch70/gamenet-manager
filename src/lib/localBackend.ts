/**
 * Local Backend — fully client-side, localStorage-backed alternative to Supabase.
 * Used when there is no internet/Supabase connection or when the user picks
 * "Local Mode" on the auth page.
 *
 * Data is namespaced per-user (a single "local" user) and survives page reloads.
 * When the user later signs in to Supabase, queued mutations + bulk data
 * can be synced via `syncLocalToSupabase()`.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= Types =============
export type LocalDeviceType = 'pc' | 'playstation' | 'billiard' | 'other';
export type LocalDeviceStatus = 'available' | 'occupied' | 'maintenance';

export interface LocalDevice {
  id: string;
  name: string;
  type: LocalDeviceType;
  status: LocalDeviceStatus;
  hourly_rate: number;
  game_center_id: string;
  created_at: string;
  updated_at: string;
}

export interface LocalDeviceSession {
  id: string;
  device_id: string;
  game_center_id: string;
  user_id: string | null;
  customer_name: string | null;
  start_time: string;
  end_time: string | null;
  is_paused: boolean;
  paused_at: string | null;
  total_paused_seconds: number;
  total_cost: number | null;
  created_at: string;
}

export interface LocalProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  is_active: boolean;
  game_center_id: string;
  created_at: string;
  updated_at: string;
}

export interface LocalSale {
  id: string;
  product_id: string | null;
  device_id: string | null;
  game_center_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  customer_name: string | null;
  sold_by: string | null;
  created_at: string;
}

export interface LocalGameCenter {
  id: string;
  name: string;
  owner_id: string;
  default_rates: { pc: number; playstation: number; billiard: number };
}

// ============= Constants =============
const MODE_KEY = 'app_mode'; // 'local' | 'cloud' | unset
const LOCAL_USER_ID = 'local-user-0001';
const LOCAL_GAME_CENTER_ID = 'local-gc-0001';

const KEYS = {
  gameCenter: 'local_game_center',
  devices: 'local_devices',
  products: 'local_products',
  sessions: 'local_device_sessions',
  sales: 'local_sales',
  syncQueue: 'local_sync_queue',
};

// ============= Helpers =============
function uid(prefix = 'l') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ============= Mode =============
export function isLocalMode(): boolean {
  return localStorage.getItem(MODE_KEY) === 'local';
}

export function enableLocalMode() {
  localStorage.setItem(MODE_KEY, 'local');
  seedIfEmpty();
}

export function disableLocalMode() {
  localStorage.removeItem(MODE_KEY);
}

// ============= Local "auth" =============
export function getLocalUser() {
  return {
    id: LOCAL_USER_ID,
    email: 'local@offline.local',
    user_metadata: { full_name: 'کاربر لوکال' },
  };
}

export function getLocalGameCenter(): LocalGameCenter {
  return read<LocalGameCenter>(KEYS.gameCenter, {
    id: LOCAL_GAME_CENTER_ID,
    name: 'گیم نت لوکال',
    owner_id: LOCAL_USER_ID,
    default_rates: { pc: 50000, playstation: 80000, billiard: 120000 },
  });
}

export function updateLocalGameCenter(updates: Partial<LocalGameCenter>) {
  const current = getLocalGameCenter();
  const next = { ...current, ...updates };
  write(KEYS.gameCenter, next);
  return next;
}

// ============= Seed defaults =============
function seedIfEmpty() {
  if (!localStorage.getItem(KEYS.gameCenter)) {
    write(KEYS.gameCenter, getLocalGameCenter());
  }
  if (!localStorage.getItem(KEYS.devices)) {
    const now = new Date().toISOString();
    const gc = LOCAL_GAME_CENTER_ID;
    const devices: LocalDevice[] = [
      { id: uid('d'), name: 'PC شماره ۱', type: 'pc', status: 'available', hourly_rate: 50000, game_center_id: gc, created_at: now, updated_at: now },
      { id: uid('d'), name: 'PC شماره ۲', type: 'pc', status: 'available', hourly_rate: 50000, game_center_id: gc, created_at: now, updated_at: now },
      { id: uid('d'), name: 'پلی‌استیشن ۱', type: 'playstation', status: 'available', hourly_rate: 80000, game_center_id: gc, created_at: now, updated_at: now },
      { id: uid('d'), name: 'بیلیارد ۱', type: 'billiard', status: 'available', hourly_rate: 120000, game_center_id: gc, created_at: now, updated_at: now },
    ];
    write(KEYS.devices, devices);
  }
  if (!localStorage.getItem(KEYS.products)) {
    const now = new Date().toISOString();
    const gc = LOCAL_GAME_CENTER_ID;
    const products: LocalProduct[] = [
      { id: uid('p'), name: 'نوشابه', price: 15000, stock: 50, category: 'نوشیدنی', is_active: true, game_center_id: gc, created_at: now, updated_at: now },
      { id: uid('p'), name: 'چیپس', price: 25000, stock: 40, category: 'خوراکی', is_active: true, game_center_id: gc, created_at: now, updated_at: now },
      { id: uid('p'), name: 'آب معدنی', price: 8000, stock: 100, category: 'نوشیدنی', is_active: true, game_center_id: gc, created_at: now, updated_at: now },
    ];
    write(KEYS.products, products);
  }
  if (!localStorage.getItem(KEYS.sessions)) write(KEYS.sessions, []);
  if (!localStorage.getItem(KEYS.sales)) write(KEYS.sales, []);
  if (!localStorage.getItem(KEYS.syncQueue)) write(KEYS.syncQueue, []);
}

// ============= Devices =============
export function getDevices(): LocalDevice[] {
  return read<LocalDevice[]>(KEYS.devices, []);
}
export function setDevices(devices: LocalDevice[]) {
  write(KEYS.devices, devices);
}
export function addLocalDevice(d: Omit<LocalDevice, 'id' | 'created_at' | 'updated_at' | 'game_center_id'>) {
  const now = new Date().toISOString();
  const device: LocalDevice = {
    ...d,
    id: uid('d'),
    game_center_id: LOCAL_GAME_CENTER_ID,
    created_at: now,
    updated_at: now,
  };
  setDevices([...getDevices(), device]);
  enqueueSync({ type: 'device.insert', payload: device });
  return device;
}
export function updateLocalDevice(id: string, updates: Partial<LocalDevice>) {
  const devices = getDevices().map(d =>
    d.id === id ? { ...d, ...updates, updated_at: new Date().toISOString() } : d
  );
  setDevices(devices);
  enqueueSync({ type: 'device.update', payload: { id, updates } });
}
export function deleteLocalDevice(id: string) {
  setDevices(getDevices().filter(d => d.id !== id));
  enqueueSync({ type: 'device.delete', payload: { id } });
}

// ============= Sessions =============
export function getSessions(): LocalDeviceSession[] {
  return read<LocalDeviceSession[]>(KEYS.sessions, []);
}
export function setSessions(sessions: LocalDeviceSession[]) {
  write(KEYS.sessions, sessions);
}
export function startLocalSession(deviceId: string, customerName: string | null) {
  const now = new Date().toISOString();
  const session: LocalDeviceSession = {
    id: uid('s'),
    device_id: deviceId,
    game_center_id: LOCAL_GAME_CENTER_ID,
    user_id: LOCAL_USER_ID,
    customer_name: customerName,
    start_time: now,
    end_time: null,
    is_paused: false,
    paused_at: null,
    total_paused_seconds: 0,
    total_cost: null,
    created_at: now,
  };
  setSessions([...getSessions(), session]);
  updateLocalDevice(deviceId, { status: 'occupied' });
  enqueueSync({ type: 'session.insert', payload: session });
  return session;
}
export function updateLocalSession(id: string, updates: Partial<LocalDeviceSession>) {
  setSessions(getSessions().map(s => (s.id === id ? { ...s, ...updates } : s)));
  enqueueSync({ type: 'session.update', payload: { id, updates } });
}

// ============= Products =============
export function getProducts(): LocalProduct[] {
  return read<LocalProduct[]>(KEYS.products, []);
}
export function setProducts(products: LocalProduct[]) {
  write(KEYS.products, products);
}
export function addLocalProduct(p: Omit<LocalProduct, 'id' | 'created_at' | 'updated_at' | 'is_active' | 'game_center_id'>) {
  const now = new Date().toISOString();
  const product: LocalProduct = {
    ...p,
    id: uid('p'),
    is_active: true,
    game_center_id: LOCAL_GAME_CENTER_ID,
    created_at: now,
    updated_at: now,
  };
  setProducts([...getProducts(), product]);
  enqueueSync({ type: 'product.insert', payload: product });
  return product;
}
export function updateLocalProduct(id: string, updates: Partial<LocalProduct>) {
  setProducts(
    getProducts().map(p =>
      p.id === id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p
    )
  );
  enqueueSync({ type: 'product.update', payload: { id, updates } });
}
export function deleteLocalProduct(id: string) {
  updateLocalProduct(id, { is_active: false });
}

// ============= Sales =============
export function getSales(): LocalSale[] {
  return read<LocalSale[]>(KEYS.sales, []);
}
export function setSales(sales: LocalSale[]) {
  write(KEYS.sales, sales);
}
export function addLocalSales(items: Omit<LocalSale, 'id' | 'created_at' | 'game_center_id' | 'sold_by'>[]) {
  const now = new Date().toISOString();
  const newSales: LocalSale[] = items.map(it => ({
    ...it,
    id: uid('sale'),
    game_center_id: LOCAL_GAME_CENTER_ID,
    sold_by: LOCAL_USER_ID,
    created_at: now,
  }));
  setSales([...getSales(), ...newSales]);
  // decrement stock
  const products = getProducts();
  for (const s of newSales) {
    if (!s.product_id) continue;
    const p = products.find(x => x.id === s.product_id);
    if (p) p.stock = Math.max(0, p.stock - s.quantity);
  }
  setProducts(products);
  newSales.forEach(s => enqueueSync({ type: 'sale.insert', payload: s }));
  return newSales;
}

// ============= Sync queue =============
interface SyncOp {
  type: string;
  payload: any;
  ts: number;
}

function enqueueSync(op: Omit<SyncOp, 'ts'>) {
  const q = read<SyncOp[]>(KEYS.syncQueue, []);
  q.push({ ...op, ts: Date.now() });
  write(KEYS.syncQueue, q);
}

export function getSyncQueueSize(): number {
  return read<SyncOp[]>(KEYS.syncQueue, []).length;
}

export function clearLocalData() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  disableLocalMode();
}

/**
 * Push all local data to Supabase under the currently authenticated user's
 * game center. Best-effort: duplicates IDs are remapped server-side.
 */
export async function syncLocalToSupabase(gameCenterId: string, userId: string): Promise<{
  ok: boolean;
  counts: { devices: number; products: number; sessions: number; sales: number };
  error?: string;
}> {
  const counts = { devices: 0, products: 0, sessions: 0, sales: 0 };
  try {
    // Map of local id -> new uuid for FK rewiring
    const deviceIdMap = new Map<string, string>();
    const productIdMap = new Map<string, string>();

    // Devices
    const devices = getDevices();
    for (const d of devices) {
      const { data, error } = await supabase
        .from('devices')
        .insert({
          name: d.name,
          type: d.type as any,
          status: d.status as any,
          hourly_rate: d.hourly_rate,
          game_center_id: gameCenterId,
        })
        .select('id')
        .single();
      if (!error && data) {
        deviceIdMap.set(d.id, data.id);
        counts.devices++;
      }
    }

    // Products
    const products = getProducts();
    for (const p of products) {
      const { data, error } = await supabase
        .from('products')
        .insert({
          name: p.name,
          price: p.price,
          stock: p.stock,
          category: p.category,
          is_active: p.is_active,
          game_center_id: gameCenterId,
        })
        .select('id')
        .single();
      if (!error && data) {
        productIdMap.set(p.id, data.id);
        counts.products++;
      }
    }

    // Sessions
    const sessions = getSessions();
    for (const s of sessions) {
      const remoteDeviceId = deviceIdMap.get(s.device_id);
      if (!remoteDeviceId) continue;
      const { error } = await supabase.from('device_sessions').insert({
        device_id: remoteDeviceId,
        game_center_id: gameCenterId,
        user_id: userId,
        customer_name: s.customer_name,
        start_time: s.start_time,
        end_time: s.end_time,
        is_paused: s.is_paused,
        paused_at: s.paused_at,
        total_paused_seconds: s.total_paused_seconds,
        total_cost: s.total_cost,
      });
      if (!error) counts.sessions++;
    }

    // Sales
    const sales = getSales();
    for (const sa of sales) {
      const remoteProductId = sa.product_id ? productIdMap.get(sa.product_id) : null;
      const remoteDeviceId = sa.device_id ? deviceIdMap.get(sa.device_id) : null;
      const { error } = await supabase.from('sales').insert({
        product_id: remoteProductId ?? null,
        device_id: remoteDeviceId ?? null,
        game_center_id: gameCenterId,
        quantity: sa.quantity,
        unit_price: sa.unit_price,
        total_price: sa.total_price,
        customer_name: sa.customer_name,
        sold_by: userId,
      });
      if (!error) counts.sales++;
    }

    return { ok: true, counts };
  } catch (e: any) {
    return { ok: false, counts, error: e?.message || 'sync failed' };
  }
}

// ============= Cloud cache (offline fallback for signed-in users) =============
// When a cloud user is online, fetched server data is mirrored into
// localStorage namespaced by user id. When the connection drops, hooks
// fall back to this cache so the app keeps working with the last known data.

export interface CloudCache {
  gameCenter: any | null;
  devices: any[];
  sessions: any[];
  products: any[];
  sales: any[];
  cachedAt: string;
}

const cloudCacheKey = (userId: string) => `cloud_cache_${userId}`;

export function getCloudCache(userId: string): CloudCache | null {
  return read<CloudCache | null>(cloudCacheKey(userId), null);
}

export function updateCloudCache(userId: string, partial: Partial<Omit<CloudCache, 'cachedAt'>>) {
  const current = getCloudCache(userId) || {
    gameCenter: null, devices: [], sessions: [], products: [], sales: [], cachedAt: '',
  };
  write(cloudCacheKey(userId), { ...current, ...partial, cachedAt: new Date().toISOString() });
}

export function clearCloudCache(userId: string) {
  localStorage.removeItem(cloudCacheKey(userId));
}

// ============= Connection probe =============
export async function probeSupabase(timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = (import.meta as any).env.VITE_SUPABASE_URL;
    if (!url) return false;
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: controller.signal,
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
