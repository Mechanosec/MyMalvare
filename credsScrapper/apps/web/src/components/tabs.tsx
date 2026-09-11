interface ITab {
  readonly id: string;
  readonly label: string;
}

interface ITabsProps {
  readonly tabs: readonly ITab[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
}

export function Tabs({ tabs, activeId, onChange }: ITabsProps) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              active
                ? 'border-accent text-text'
                : 'border-transparent text-text-dim hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
