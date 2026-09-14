import { useCallback, useEffect, useState } from 'react';
import { useAppData, useNow, useSnapshot } from './db/hooks';
import { requestPersistence } from './db/schema';
import { cx } from './components/ui';
import AddEntry, { type EntryMode } from './screens/AddEntry';
import History from './screens/History';
import Home from './screens/Home';
import Import from './screens/Import';
import Onboarding from './screens/Onboarding';
import Report from './screens/Report';
import Settings from './screens/Settings';

export type Tab = 'home' | 'history' | 'report' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { id: 'history', label: 'History', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'report', label: 'Report', icon: 'M5 20V11m7 9V4m7 16v-6' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

export default function App() {
  const data = useAppData();
  const now = useNow();
  const snap = useSnapshot(data, now);
  const [tab, setTab] = useState<Tab>('home');
  const [entry, setEntry] = useState<EntryMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (data?.settings.onboarded) requestPersistence();
  }, [data?.settings.onboarded]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const openEntry = useCallback((mode: EntryMode) => setEntry(mode), []);
  const closeEntry = useCallback(() => setEntry(null), []);
  const closeImport = useCallback(() => setImportOpen(false), []);

  if (!data) return <div className="min-h-dvh bg-bg" />;
  if (!data.settings.onboarded) return <Onboarding />;
  if (!snap) return null;

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <main className="pt-safe px-4 pb-32">
        {tab === 'home' && <Home data={data} snap={snap} onAdd={openEntry} onNavigate={setTab} />}
        {tab === 'history' && <History data={data} onImport={() => setImportOpen(true)} />}
        {tab === 'report' && <Report data={data} snap={snap} />}
        {tab === 'settings' && <Settings data={data} snap={snap} onImport={() => setImportOpen(true)} />}
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5">
          {TABS.slice(0, 2).map((t) => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
          <div className="flex w-16 justify-center">
            <button
              aria-label="Add expense"
              onClick={() => openEntry('expense')}
              className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg shadow-accent/30 active:scale-95"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {TABS.slice(2).map((t) => (
            <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
        </div>
      </nav>

      {entry && <AddEntry data={data} snap={snap} initialMode={entry} onClose={closeEntry} />}
      {importOpen && <Import data={data} onClose={closeImport} />}
    </div>
  );
}

function TabButton({ tab, active, onClick }: { tab: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx('flex min-h-12 w-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-accent' : 'text-ink-3')}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d={tab.icon} />
      </svg>
      {tab.label}
    </button>
  );
}
