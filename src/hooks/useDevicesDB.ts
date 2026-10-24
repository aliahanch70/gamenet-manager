import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Database } from '@/integrations/supabase/types';
import * as local from '@/lib/localBackend';

type Device = Database['public']['Tables']['devices']['Row'];
type DeviceSession = Database['public']['Tables']['device_sessions']['Row'];
type DeviceType = Database['public']['Enums']['device_type'];
type DeviceStatus = Database['public']['Enums']['device_status'];

export interface DeviceWithSession extends Device {
  currentSession?: DeviceSession | null;
}

export interface NewDevice {
  name: string;
  type: DeviceType;
  hourly_rate: number;
}

export function useDevicesDB() {
  const [devices, setDevices] = useState<DeviceWithSession[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, gameCenter, isLocalMode } = useAuth();

  const fetchDevices = useCallback(async () => {
    if (isLocalMode) {
      const ds = local.getDevices();
      const sessions = local.getSessions().filter(s => !s.end_time);
      setDevices(ds.map(d => ({
        ...(d as unknown as Device),
        currentSession: (sessions.find(s => s.device_id === d.id) as unknown as DeviceSession) || null,
      })));
      setLoading(false);
      return;
    }

    if (!gameCenter?.id) {
      setLoading(false);
      return;
    }
    try {
      const { data: devicesData, error: devicesError } = await supabase
        .from('devices').select('*').eq('game_center_id', gameCenter.id).order('name');
      if (devicesError) throw devicesError;

      const { data: sessionsData, error: sessionsError } = await supabase
        .from('device_sessions').select('*').eq('game_center_id', gameCenter.id).is('end_time', null);
      if (sessionsError) throw sessionsError;

      setDevices((devicesData || []).map(device => ({
        ...device,
        currentSession: sessionsData?.find(s => s.device_id === device.id) || null,
      })));
      // mirror to local cache for offline use
      if (user?.id) {
        local.updateCloudCache(user.id, {
          devices: devicesData || [],
          sessions: sessionsData || [],
          gameCenter,
        });
      }
    } catch (error) {
      console.error('Error fetching devices:', error);
      // offline fallback: use last cached server data
      const cache = user?.id ? local.getCloudCache(user.id) : null;
      if (cache) {
        const cachedSessions = (cache.sessions || []).filter((s: any) => !s.end_time);
        setDevices((cache.devices || []).map((d: any) => ({
          ...d,
          currentSession: cachedSessions.find((s: any) => s.device_id === d.id) || null,
        })));
        toast.info('اتصال قطع است — نمایش آخرین اطلاعات ذخیره‌شده');
      } else {
        toast.error('خطا در دریافت اطلاعات دستگاه‌ها');
      }
    } finally {
      setLoading(false);
    }
  }, [gameCenter?.id, isLocalMode]);

  useEffect(() => {
    if (isLocalMode || (user && gameCenter)) fetchDevices();
  }, [user, gameCenter, isLocalMode, fetchDevices]);

  const addDevice = async (newDevice: NewDevice) => {
    if (isLocalMode) {
      local.addLocalDevice({ name: newDevice.name, type: newDevice.type as any, hourly_rate: newDevice.hourly_rate, status: 'available' });
      toast.success('دستگاه با موفقیت اضافه شد');
      fetchDevices();
      return { success: true };
    }
    if (!gameCenter?.id) return { success: false };
    try {
      const { error } = await supabase.from('devices').insert({
        name: newDevice.name, type: newDevice.type, hourly_rate: newDevice.hourly_rate,
        status: 'available' as DeviceStatus, game_center_id: gameCenter.id,
      });
      if (error) throw error;
      toast.success('دستگاه با موفقیت اضافه شد');
      fetchDevices();
      return { success: true };
    } catch (e) {
      toast.error('خطا در افزودن دستگاه');
      return { success: false };
    }
  };

  const deleteDevice = async (deviceId: string) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device) return { success: false };
    if (device.status === 'occupied') {
      toast.error('امکان حذف دستگاه مشغول وجود ندارد');
      return { success: false };
    }
    if (isLocalMode) {
      local.deleteLocalDevice(deviceId);
      toast.success('دستگاه حذف شد');
      fetchDevices();
      return { success: true };
    }
    try {
      const { error } = await supabase.from('devices').delete().eq('id', deviceId);
      if (error) throw error;
      toast.success('دستگاه حذف شد');
      fetchDevices();
      return { success: true };
    } catch {
      toast.error('خطا در حذف دستگاه');
      return { success: false };
    }
  };

  const updateDevice = async (deviceId: string, updates: { name?: string; hourly_rate?: number }) => {
    if (isLocalMode) {
      local.updateLocalDevice(deviceId, updates as any);
      toast.success('اطلاعات دستگاه به‌روز شد');
      fetchDevices();
      return { success: true };
    }
    try {
      const { error } = await supabase.from('devices').update(updates).eq('id', deviceId);
      if (error) throw error;
      toast.success('اطلاعات دستگاه به‌روز شد');
      fetchDevices();
      return { success: true };
    } catch {
      toast.error('خطا در به‌روزرسانی دستگاه');
      return { success: false };
    }
  };

  const updateDeviceStatus = async (deviceId: string, status: DeviceStatus) => {
    if (isLocalMode) {
      local.updateLocalDevice(deviceId, { status: status as any });
      toast.success('وضعیت دستگاه به‌روز شد');
      fetchDevices();
      return { success: true };
    }
    try {
      const { error } = await supabase.from('devices').update({ status }).eq('id', deviceId);
      if (error) throw error;
      toast.success('وضعیت دستگاه به‌روز شد');
      fetchDevices();
      return { success: true };
    } catch {
      toast.error('خطا در به‌روزرسانی وضعیت');
      return { success: false };
    }
  };

  const startSession = async (deviceId: string, customerName?: string) => {
    if (isLocalMode) {
      local.startLocalSession(deviceId, customerName || null);
      toast.success('زمان‌بندی شروع شد');
      fetchDevices();
      return;
    }
    if (!gameCenter?.id) return;
    try {
      const { error: sessionError } = await supabase.from('device_sessions').insert({
        device_id: deviceId, game_center_id: gameCenter.id, user_id: user?.id,
        start_time: new Date().toISOString(), is_paused: false, total_paused_seconds: 0,
        customer_name: customerName || null,
      });
      if (sessionError) throw sessionError;
      const { error: deviceError } = await supabase.from('devices').update({ status: 'occupied' as DeviceStatus }).eq('id', deviceId);
      if (deviceError) throw deviceError;
      toast.success('زمان‌بندی شروع شد');
      fetchDevices();
    } catch {
      toast.error('خطا در شروع زمان‌بندی');
    }
  };

  const pauseSession = async (deviceId: string) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device?.currentSession) return;
    const session = device.currentSession;

    if (isLocalMode) {
      if (session.is_paused) {
        const pausedAt = new Date(session.paused_at!);
        const additional = Math.floor((Date.now() - pausedAt.getTime()) / 1000);
        local.updateLocalSession(session.id, {
          is_paused: false, paused_at: null,
          total_paused_seconds: (session.total_paused_seconds || 0) + additional,
        });
        toast.success('زمان‌بندی ادامه یافت');
      } else {
        local.updateLocalSession(session.id, { is_paused: true, paused_at: new Date().toISOString() });
        toast.success('زمان‌بندی متوقف شد');
      }
      fetchDevices();
      return;
    }

    try {
      if (session.is_paused) {
        const pausedAt = new Date(session.paused_at!);
        const additional = Math.floor((Date.now() - pausedAt.getTime()) / 1000);
        const { error } = await supabase.from('device_sessions').update({
          is_paused: false, paused_at: null,
          total_paused_seconds: (session.total_paused_seconds || 0) + additional,
        }).eq('id', session.id);
        if (error) throw error;
        toast.success('زمان‌بندی ادامه یافت');
      } else {
        const { error } = await supabase.from('device_sessions').update({
          is_paused: true, paused_at: new Date().toISOString(),
        }).eq('id', session.id);
        if (error) throw error;
        toast.success('زمان‌بندی متوقف شد');
      }
      fetchDevices();
    } catch {
      toast.error('خطا در تغییر وضعیت');
    }
  };

  const stopSession = async (deviceId: string): Promise<{
    success: boolean;
    invoiceData?: {
      deviceName: string; deviceType: string; customerName: string | null;
      startTime: Date; endTime: Date; totalSeconds: number; hourlyRate: number; deviceCost: number;
      buffetSales: Array<{ product_name: string; quantity: number; unit_price: number; total_price: number }>;
      buffetTotal: number; grandTotal: number;
    };
  }> => {
    const device = devices.find(d => d.id === deviceId);
    if (!device?.currentSession) return { success: false };
    const session = device.currentSession;

    const startTime = new Date(session.start_time);
    const endTime = new Date();
    let totalPausedSeconds = session.total_paused_seconds || 0;
    if (session.is_paused && session.paused_at) {
      totalPausedSeconds += Math.floor((endTime.getTime() - new Date(session.paused_at).getTime()) / 1000);
    }
    const totalSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000) - totalPausedSeconds;
    const totalCost = Math.ceil((totalSeconds / 3600) * device.hourly_rate);

    if (isLocalMode) {
      const products = local.getProducts();
      const salesInWindow = local.getSales().filter(s =>
        s.device_id === deviceId &&
        new Date(s.created_at) >= startTime &&
        new Date(s.created_at) <= endTime
      );
      const buffetSales = salesInWindow.map(s => ({
        product_name: products.find(p => p.id === s.product_id)?.name || 'محصول حذف شده',
        quantity: s.quantity, unit_price: s.unit_price, total_price: s.total_price,
      }));
      const buffetTotal = buffetSales.reduce((sum, i) => sum + i.total_price, 0);

      local.updateLocalSession(session.id, {
        end_time: endTime.toISOString(), total_cost: totalCost,
        is_paused: false, paused_at: null, total_paused_seconds: totalPausedSeconds,
      });
      local.updateLocalDevice(deviceId, { status: 'available' });
      fetchDevices();
      return {
        success: true,
        invoiceData: {
          deviceName: device.name, deviceType: device.type, customerName: session.customer_name,
          startTime, endTime, totalSeconds, hourlyRate: device.hourly_rate, deviceCost: totalCost,
          buffetSales, buffetTotal, grandTotal: totalCost + buffetTotal,
        },
      };
    }

    try {
      const { data: salesData, error: salesError } = await supabase
        .from('sales').select('*, products!sales_product_id_fkey(name)')
        .eq('device_id', deviceId).gte('created_at', session.start_time).lte('created_at', endTime.toISOString());
      if (salesError) throw salesError;

      const buffetSales = (salesData || []).map(sale => ({
        product_name: (sale.products as any)?.name || 'محصول حذف شده',
        quantity: sale.quantity, unit_price: sale.unit_price, total_price: sale.total_price,
      }));
      const buffetTotal = buffetSales.reduce((sum, item) => sum + item.total_price, 0);

      const { error: sessionError } = await supabase.from('device_sessions').update({
        end_time: endTime.toISOString(), total_cost: totalCost,
        is_paused: false, paused_at: null, total_paused_seconds: totalPausedSeconds,
      }).eq('id', session.id);
      if (sessionError) throw sessionError;

      const { error: deviceError } = await supabase.from('devices')
        .update({ status: 'available' as DeviceStatus }).eq('id', deviceId);
      if (deviceError) throw deviceError;

      fetchDevices();
      return {
        success: true,
        invoiceData: {
          deviceName: device.name, deviceType: device.type, customerName: session.customer_name,
          startTime, endTime, totalSeconds, hourlyRate: device.hourly_rate, deviceCost: totalCost,
          buffetSales, buffetTotal, grandTotal: totalCost + buffetTotal,
        },
      };
    } catch {
      toast.error('خطا در پایان زمان‌بندی');
      return { success: false };
    }
  };

  const updateSessionCustomerName = async (deviceId: string, customerName: string | null) => {
    const device = devices.find(d => d.id === deviceId);
    if (!device?.currentSession) return { success: false };
    if (isLocalMode) {
      local.updateLocalSession(device.currentSession.id, { customer_name: customerName });
      toast.success('نام مشتری به‌روز شد');
      fetchDevices();
      return { success: true };
    }
    try {
      const { error } = await supabase.from('device_sessions').update({ customer_name: customerName })
        .eq('id', device.currentSession.id);
      if (error) throw error;
      toast.success('نام مشتری به‌روز شد');
      fetchDevices();
      return { success: true };
    } catch {
      toast.error('خطا در به‌روزرسانی نام مشتری');
      return { success: false };
    }
  };

  const getStats = () => {
    const available = devices.filter(d => d.status === 'available').length;
    const occupied = devices.filter(d => d.status === 'occupied').length;
    const maintenance = devices.filter(d => d.status === 'maintenance').length;
    return { available, occupied, maintenance, total: devices.length };
  };

  return {
    devices, loading, addDevice, deleteDevice, updateDevice, updateDeviceStatus,
    startSession, pauseSession, stopSession, updateSessionCustomerName, getStats,
    refetch: fetchDevices,
  };
}
