import { DndContext, PointerSensor, TouchSensor, useDroppable, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import React, { useEffect, useMemo, useState } from 'react';
import html2canvas from 'html2canvas';

const logoUrl = `${import.meta.env.BASE_URL}logo.png`;

type Item = { id: string; label: string };
type Tier = { id: string; title: string; itemIds: string[] };
type Board = { title: string; tiers: Tier[]; items: Item[] };

const STORAGE_VERSION = 1;

const createId = () => Math.random().toString(36).slice(2, 10);

const defaultBoard = (): Board => ({
  title: 'My Tier List',
  tiers: [
    { id: createId(), title: 'S', itemIds: [] },
    { id: createId(), title: 'A', itemIds: [] },
    { id: createId(), title: 'B', itemIds: [] },
    { id: createId(), title: 'C', itemIds: [] },
  ],
  items: [],
});

type SerializedState = { v: number; board: Board };

const encodeState = (state: SerializedState) => {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const decodeState = (value: string | null): Board | null => {
  if (!value) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SerializedState;
    if (parsed.v !== STORAGE_VERSION) return null;
    return parsed.board;
  } catch {
    return null;
  }
};

const findItemContainer = (board: Board, itemId: string) => {
  for (const tier of board.tiers) {
    if (tier.itemIds.includes(itemId)) return tier.id;
  }
  return 'pool';
};

const moveItem = (board: Board, itemId: string, toTierId: string | 'pool') => {
  const fromTier = board.tiers.find((tier) => tier.itemIds.includes(itemId));
  if (fromTier) fromTier.itemIds = fromTier.itemIds.filter((id) => id !== itemId);

  if (toTierId !== 'pool') {
    const tier = board.tiers.find((entry) => entry.id === toTierId);
    if (tier && !tier.itemIds.includes(itemId)) tier.itemIds = [...tier.itemIds, itemId];
  }
};

const moveTier = (board: Board, tierId: string, toTierId: string | 'pool') => {
  const fromIndex = board.tiers.findIndex((tier) => tier.id === tierId);
  if (fromIndex === -1) return;

  const [tier] = board.tiers.splice(fromIndex, 1);
  if (toTierId === 'pool') {
    board.tiers.push(tier);
    return;
  }

  const toIndex = board.tiers.findIndex((entry) => entry.id === toTierId);
  if (toIndex === -1) {
    board.tiers.push(tier);
    return;
  }

  board.tiers.splice(toIndex, 0, tier);
};

const moveTierByOffset = (board: Board, tierId: string, offset: number) => {
  const fromIndex = board.tiers.findIndex((tier) => tier.id === tierId);
  const toIndex = fromIndex + offset;
  if (fromIndex === -1 || toIndex < 0 || toIndex >= board.tiers.length) return;

  const [tier] = board.tiers.splice(fromIndex, 1);
  board.tiers.splice(toIndex, 0, tier);
};

const deleteItem = (board: Board, itemId: string) => {
  board.items = board.items.filter((item) => item.id !== itemId);
  board.tiers = board.tiers.map((tier) => ({ ...tier, itemIds: tier.itemIds.filter((id) => id !== itemId) }));
};

function App() {
  const [board, setBoard] = useState<Board>(() => decodeState(new URLSearchParams(window.location.hash.slice(1)).get('s')) ?? defaultBoard());
  const [newItemLabel, setNewItemLabel] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const boardRef = React.useRef<HTMLElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
  );

  useEffect(() => {
    const encoded = encodeState({ v: STORAGE_VERSION, board });
    const url = new URL(window.location.href);
    url.hash = `s=${encoded}`;
    window.history.replaceState(null, '', url.toString());
  }, [board]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    document.title = 'tear';

    const setIcon = (rel: string) => {
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = logoUrl;
    };

    setIcon('icon');
    setIcon('apple-touch-icon');
  }, []);

  const itemMap = useMemo(() => new Map(board.items.map((item) => [item.id, item])), [board.items]);

  const onAddItem = () => {
    const labels = newItemLabel
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);

    if (!labels.length) return;

    setBoard((current) => ({
      ...current,
      items: [...current.items, ...labels.map((label) => ({ id: createId(), label }))],
    }));
    setNewItemLabel('');
  };

  const onAddTier = () => {
    setBoard((current) => ({
      ...current,
      tiers: [...current.tiers, { id: createId(), title: `Tier ${current.tiers.length + 1}`, itemIds: [] }],
    }));
  };

  const onCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  };

  const onDownloadPng = async () => {
    const node = boardRef.current;
    if (!node || exporting) return;

    setExporting(true);
    let clone: HTMLElement | null = null;
    try {
      await document.fonts.ready;
      clone = node.cloneNode(true) as HTMLElement;
      const title = document.createElement('div');
      title.textContent = board.title.trim() || 'tear';
      title.style.padding = '0 0 16px';
      title.style.margin = '0 0 16px';
      title.style.borderBottom = '1px solid #e0e0e0';
      title.style.fontSize = '42px';
      title.style.fontWeight = '700';
      title.style.letterSpacing = '-0.05em';
      title.style.lineHeight = '1.05';
      title.style.color = '#111111';
      clone.prepend(title);
      clone.querySelectorAll('.add-tier-row, .pool, .composer, .trash-can').forEach((element) => element.remove());
      clone.querySelectorAll('.tier-row').forEach((element) => {
        const row = element as HTMLElement;
        row.style.gridTemplateColumns = 'max-content minmax(0, 1fr)';
        row.style.borderTop = '1px solid rgba(92, 69, 51, 0.12)';
      });
      clone.querySelectorAll('.tier-controls').forEach((element) => element.remove());
      clone.style.width = `${node.getBoundingClientRect().width}px`;
      clone.style.position = 'fixed';
      clone.style.left = '-10000px';
      clone.style.top = '0';
      clone.style.margin = '0';
      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, {
        backgroundColor: '#f4efe6',
        scale: Math.max(2, window.devicePixelRatio || 1),
        useCORS: true,
        width: clone.scrollWidth,
        height: clone.scrollHeight,
        windowWidth: clone.scrollWidth,
        windowHeight: clone.scrollHeight,
      });

      clone.remove();

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${board.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'tier-list'}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      clone?.remove();
      setExporting(false);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveItemId(String(active.id))}
      onDragCancel={() => setActiveItemId(null)}
      onDragEnd={({ active, over }) => {
        setActiveItemId(null);
        if (!over) return;
        const activeId = String(active.id);
        const target = String(over.id);
        if (activeId === target) return;

        const itemId = activeId;
        if (target === 'trash') {
          setBoard((current) => {
            const next = structuredClone(current);
            deleteItem(next, itemId);
            return next;
          });
          return;
        }
        if (target === 'pool') {
          setBoard((current) => ({ ...current, tiers: current.tiers.map((tier) => ({ ...tier, itemIds: tier.itemIds.filter((id) => id !== itemId) })) }));
          return;
        }
        if (target.startsWith('tier:')) {
          const tierId = target.slice(5);
          setBoard((current) => {
            const next = structuredClone(current);
            moveItem(next, itemId, tierId);
            return next;
          });
        }
      }}
    >
      <div className="app-shell">
        <header className="topbar">
          <div>
            <input
              className="board-title"
              value={board.title}
              placeholder="Add a title"
              onChange={(event) => setBoard((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
          <div className="actions">
            <button onClick={onDownloadPng} disabled={exporting}>{exporting ? 'Saving...' : 'Save'}</button>
            <button onClick={onCopyLink}>{copied ? 'Link copied' : 'Share'}</button>
            <img className="site-mark" src={logoUrl} alt="tear" />
          </div>
        </header>

        <main ref={boardRef} className="board">
          {board.tiers.map((tier, index) => (
            <TierRow
              key={tier.id}
              tier={tier}
              tierIndex={index}
              items={tier.itemIds.map((id) => itemMap.get(id)).filter(Boolean) as Item[]}
              activeItemId={activeItemId}
              onTitleChange={(title) => {
                setBoard((current) => ({
                  ...current,
                  tiers: current.tiers.map((entry) => (entry.id === tier.id ? { ...entry, title } : entry)),
                }));
              }}
              onMoveUp={() => {
                setBoard((current) => {
                  const next = structuredClone(current);
                  moveTierByOffset(next, tier.id, -1);
                  return next;
                });
              }}
              onMoveDown={() => {
                setBoard((current) => {
                  const next = structuredClone(current);
                  moveTierByOffset(next, tier.id, 1);
                  return next;
                });
              }}
              onRemove={() =>
                window.confirm(`Delete the ${tier.title} tier?`) &&
                setBoard((current) => ({
                  ...current,
                  tiers: current.tiers.filter((entry) => entry.id !== tier.id),
                }))
              }
            />
          ))}

          <button className="add-tier-row" type="button" onClick={onAddTier}>
            <span className="add-tier-plus" aria-hidden="true">
              +
            </span>
            <span>Add tier</span>
          </button>

          <Pool items={board.items.filter((item) => !board.tiers.some((tier) => tier.itemIds.includes(item.id)))} activeItemId={activeItemId} />

          {activeItemId ? <TrashCan activeItemId={activeItemId} /> : null}

          <section className="composer">
            <input
              value={newItemLabel}
              placeholder="Add items, comma separated"
              onChange={(event) => setNewItemLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onAddItem();
              }}
            />
            <button onClick={onAddItem}>Add item</button>
          </section>
        </main>
      </div>
    </DndContext>
  );
}

function TierRow({ tier, tierIndex, items, onTitleChange, onRemove, onMoveUp, onMoveDown, activeItemId }: { tier: Tier; tierIndex: number; items: Item[]; onTitleChange: (title: string) => void; onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void; activeItemId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `tier:${tier.id}` });
  const chipStyle = { '--chip-color': tierColors[tierIndex % tierColors.length] } as React.CSSProperties;

  return (
    <section ref={setNodeRef} className={`tier-row ${isOver ? 'over' : ''}`}>
      <div className="tier-label">
        <input value={tier.title} onChange={(event) => onTitleChange(event.target.value)} />
      </div>
      <div className="tier-items">
        {items.map((item) => (
          <DraggableItem key={item.id} item={item} active={activeItemId === item.id} style={chipStyle} />
        ))}
      </div>
      <div className="tier-controls" aria-label={`${tier.title} tier controls`}>
        <button className="tier-move" type="button" onClick={onMoveUp} aria-label={`Move ${tier.title} up`}>
          ↑
        </button>
        <button className="tier-move" type="button" onClick={onMoveDown} aria-label={`Move ${tier.title} down`}>
          ↓
        </button>
        <button className="tier-remove" type="button" onClick={onRemove} aria-label={`Remove ${tier.title} tier`}>
          ×
        </button>
      </div>
    </section>
  );
}

function Pool({ items, activeItemId }: { items: Item[]; activeItemId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });

  return (
    <section ref={setNodeRef} className={`pool ${isOver ? 'over' : ''}`}>
      <div className="pool-header">
        <h2>Items</h2>
        <span>{items.length}</span>
      </div>
      <div className="tier-items">
        {items.map((item) => (
          <DraggableItem key={item.id} item={item} active={activeItemId === item.id} style={{ '--chip-color': '#b8b1a6' } as React.CSSProperties} />
        ))}
      </div>
    </section>
  );
}

function TrashCan({ activeItemId }: { activeItemId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash' });

  return (
    <section ref={setNodeRef} className={`trash-can ${isOver && activeItemId ? 'over' : ''}`}>
      <span className="trash-icon" aria-hidden="true">
        🗑
      </span>
      <div>
        <h2>Trash</h2>
        <p>Drop an item here to delete it.</p>
      </div>
    </section>
  );
}

const tierColors = [
  '#d45c56',
  '#4e7fc7',
  '#6a9a7c',
  '#cf8e3d',
  '#9971b8',
  '#8a8f9b',
  '#b66c62',
  '#5e88a8',
  '#85a35f',
  '#c58b68',
  '#7e6bb2',
  '#a08d5e',
];

function DraggableItem({ item, active, style }: { item: Item; active: boolean; style?: React.CSSProperties }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const transformStyle = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;

  return (
    <button
      ref={setNodeRef}
      className={`item-chip ${active || isDragging ? 'dragging' : ''}`}
      style={transformStyle ? { ...style, ...transformStyle } : style}
      {...listeners}
      {...attributes}
    >
      {item.label}
    </button>
  );
}

export { App };
