import { ChartNoAxesColumnIncreasing, House, ScanLine, Settings } from 'lucide-react';

export type Page = 'today' | 'history' | 'progress' | 'settings';

export function Nav({ page, onChange }: { page: Page; onChange: (page: Page) => void }) {
  const items = [
    { id: 'today' as const, label: 'Today', Icon: House },
    { id: 'history' as const, label: 'History', Icon: ChartNoAxesColumnIncreasing },
    { id: 'progress' as const, label: 'Photos', Icon: ScanLine },
    { id: 'settings' as const, label: 'Settings', Icon: Settings },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map(({ id, label, Icon }) => (
        <button key={id} className={page === id ? 'active' : ''} onClick={() => onChange(id)}>
          <Icon size={21} strokeWidth={page === id ? 2.6 : 2} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
