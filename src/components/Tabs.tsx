import { useStore } from '../state/store';
import type { ActiveTab } from '../types';

const TABS: ActiveTab[] = ['Parameters', 'Process', 'Binaural beats', 'Write to file'];

export function Tabs() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab}
          className={'tab' + (activeTab === tab ? ' active' : '')}
          onClick={() => setActiveTab(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
