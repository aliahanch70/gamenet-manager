import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  isLocalMode as readIsLocalMode,
  enableLocalMode as enableLocalModeStorage,
  disableLocalMode,
  getLocalUser,
  getLocalGameCenter,
  syncLocalToSupabase,
  getSyncQueueSize,
  clearLocalData,
  probeSupabase,
  getCloudCache,
  updateCloudCache,
} from '@/lib/localBackend';
import { readPersistedSession, withRecoveryTimeout } from '@/lib/offlineRecovery';

interface GameCenter {
  id: string;
  name: string;
  owner_id: string;
  address?: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: 'admin' | 'staff' | 'customer' | null;
  gameCenter: GameCenter | null;
  isLocalMode: boolean;
  signUp: (email: string, password: string, fullName: string, gameCenterName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  signInLocal: () => void;
  syncLocalToCloud: () => Promise<{ ok: boolean; counts: any; error?: string }>;
  pendingLocalChanges: number;
  isStaffOrAdmin: boolean;
  isOnline: boolean;
  syncPromptOpen: boolean;
  confirmSyncPrompt: () => Promise<void>;
  dismissSyncPrompt: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'admin' | 'staff' | 'customer' | null>(null);
  const [gameCenter, setGameCenter] = useState<GameCenter | null>(null);
  const [isLocalMode, setIsLocalMode] = useState<boolean>(readIsLocalMode());
  const [pendingLocalChanges, setPendingLocalChanges] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncPromptOpen, setSyncPromptOpen] = useState(false);
  const wasOfflineRef = useRef(false);
  const activeUserId = useRef<string | null>(null);

  // Track connectivity: browser events + periodic probe of the backend
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = navigator.onLine ? await probeSupabase() : false;
      if (!mounted) return;
      setIsOnline(prev => {
        if (!prev && ok) {
          // back online: if the user has cached cloud data, ask about syncing
          wasOfflineRef.current = false;
          setSyncPromptOpen(true);
        } else if (prev && !ok) {
          wasOfflineRef.current = true;
        }
        return ok;
      });
    };
    check();
    const onOnline = () => check();
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = setInterval(check, 30000);
    return () => {
      mounted = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  // Bootstrap local mode immediately
  useEffect(() => {
    if (readIsLocalMode()) {
      const lu = getLocalUser();
      setUser({ id: lu.id, email: lu.email, user_metadata: lu.user_metadata } as any);
      setGameCenter(getLocalGameCenter() as any);
      setUserRole('admin');
      setIsLocalMode(true);
      setPendingLocalChanges(getSyncQueueSize());
      setLoading(false);
      return;
    }

    let mounted = true;
    const applySession = (sess: Session | null) => {
      if (!mounted || readIsLocalMode()) return;
      const nextId = sess?.user.id ?? null;
      if (activeUserId.current !== nextId) {
        setUserRole(null);
        setGameCenter(null);
      }
      activeUserId.current = nextId;
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        const cache = getCloudCache(sess.user.id);
        if (cache?.gameCenter?.id) setGameCenter(cache.gameCenter);
        setTimeout(() => fetchUserData(sess.user.id), 0);
      } else {
        setUserRole(null);
        setGameCenter(null);
      }
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      applySession(sess);
    });

    withRecoveryTimeout(supabase.auth.getSession()).then(({ data: { session } }) => {
      applySession(session);
    }).catch(() => {
      // Refresh can retry indefinitely offline. Recover only this client's session.
      const host = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
      if (!activeUserId.current) applySession(readPersistedSession(localStorage, `sb-${host}-auth-token`));
      if (mounted) { setIsOnline(false); setLoading(false); }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const fetchUserData = async (userId: string) => {
    const cache = getCloudCache(userId);
    if (activeUserId.current === userId && cache?.gameCenter?.id) setGameCenter(cache.gameCenter);
    if (!navigator.onLine) return;
    try {
      const { data: roleData, error: roleError } = await withRecoveryTimeout(supabase
        .from('user_roles')
        .select('role, game_center_id')
        .eq('user_id', userId)
        .maybeSingle());

      if (activeUserId.current !== userId) return;

      if (roleError) {
        console.error('Error fetching user role:', roleError);
        return;
      }

      if (roleData) {
        setUserRole(roleData.role as 'admin' | 'staff' | 'customer');
        if (roleData.game_center_id) {
          const { data: gcData } = await withRecoveryTimeout(supabase
            .from('game_centers')
            .select('*')
            .eq('id', roleData.game_center_id)
            .maybeSingle());
          if (activeUserId.current !== userId) return;
          if (gcData) {
            setGameCenter(gcData);
            updateCloudCache(userId, { gameCenter: gcData });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const signUp = async (email: string, password: string, fullName: string, gameCenterName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { full_name: fullName, game_center_name: gameCenterName || 'گیم نت من' },
      },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await withRecoveryTimeout(supabase.auth.signInWithPassword({ email, password }));
      return { error: error as Error | null };
    } catch {
      return { error: new Error('اتصال برقرار نیست؛ لطفاً دوباره تلاش کنید یا وارد حالت لوکال شوید') };
    }
  };

  const signOut = async () => {
    if (isLocalMode) {
      disableLocalMode();
      setIsLocalMode(false);
      setUser(null);
      setGameCenter(null);
      setUserRole(null);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserRole(null);
    setGameCenter(null);
  };

  const signInLocal = () => {
    enableLocalModeStorage();
    const lu = getLocalUser();
    setUser({ id: lu.id, email: lu.email, user_metadata: lu.user_metadata } as any);
    setGameCenter(getLocalGameCenter() as any);
    setUserRole('admin');
    setIsLocalMode(true);
    setPendingLocalChanges(getSyncQueueSize());
    setLoading(false);
  };

  const syncLocalToCloud = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return { ok: false, counts: { devices: 0, products: 0, sessions: 0, sales: 0 }, error: 'ابتدا با حساب ابری وارد شوید' };
    }
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('game_center_id')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (!roleData?.game_center_id) {
      return { ok: false, counts: { devices: 0, products: 0, sessions: 0, sales: 0 }, error: 'گیم نت ابری یافت نشد' };
    }
    const result = await syncLocalToSupabase(roleData.game_center_id, data.user.id);
    if (result.ok) {
      clearLocalData();
      setPendingLocalChanges(0);
    }
    return result;
  };

  const confirmSyncPrompt = async () => {
    setSyncPromptOpen(false);
    await syncLocalToCloud();
  };

  const dismissSyncPrompt = () => setSyncPromptOpen(false);

  const isStaffOrAdmin = userRole === 'admin' || userRole === 'staff';

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        userRole,
        gameCenter,
        isLocalMode,
        signUp,
        signIn,
        signOut,
        signInLocal,
        syncLocalToCloud,
        pendingLocalChanges,
        isStaffOrAdmin,
        isOnline,
        syncPromptOpen,
        confirmSyncPrompt,
        dismissSyncPrompt,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
