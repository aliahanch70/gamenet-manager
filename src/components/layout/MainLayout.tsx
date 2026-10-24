import { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAuth } from '@/contexts/AuthContext';
import { HardDrive, CloudUpload, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

interface MainLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function MainLayout({ children, title, subtitle }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isLocalMode, syncLocalToCloud } = useAuth();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    const res = await syncLocalToCloud();
    setSyncing(false);
    if (res.ok) {
      toast.success(`همگام‌سازی موفق — دستگاه‌ها: ${res.counts.devices}، محصولات: ${res.counts.products}، جلسات: ${res.counts.sessions}، فروش: ${res.counts.sales}`);
    } else {
      toast.error(res.error || 'خطا در همگام‌سازی');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="lg:mr-64">
        <Header title={title} subtitle={subtitle} onMenuClick={() => setSidebarOpen(true)} />
        {isLocalMode && (
          <div className="mx-4 md:mx-8 mt-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-primary" />
              <span className="text-foreground">حالت لوکال فعال است — داده‌ها روی این دستگاه ذخیره می‌شوند</span>
            </div>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-2">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
              همگام‌سازی با ابر
            </Button>
          </div>
        )}
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
