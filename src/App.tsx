import { DndContext, PointerSensor, TouchSensor, useDroppable, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import React, { useEffect, useMemo, useState } from 'react';
import html2canvas from 'html2canvas';

const logoUrl = `${import.meta.env.BASE_URL}logo.png`;

type TextItem = { id: string; kind: 'text'; label: string };
type ImageItem = { id: string; kind: 'image'; src: string; name?: string };
type Item = TextItem | ImageItem;
type Tier = { id: string; title: string; itemIds: string[] };
type Board = { title: string; tiers: Tier[]; items: Item[] };
type Theme = 'light' | 'dark';
type Mode = 'text' | 'image';

const STORAGE_VERSION = 1;
const THEME_STORAGE_KEY = 'tear-theme';
const MODE_STORAGE_KEY = 'tear-mode';
const IMAGE_BOARD_STORAGE_KEY = 'tear-image-board';

const createId = () => Math.random().toString(36).slice(2, 10);

const defaultBoard = (): Board => ({
  title: 'List',
  tiers: [
    { id: createId(), title: 'S', itemIds: [] },
    { id: createId(), title: 'A', itemIds: [] },
    { id: createId(), title: 'B', itemIds: [] },
    { id: createId(), title: 'C', itemIds: [] },
  ],
  items: [],
});

const defaultTextBoard = (): Board => defaultBoard();

const defaultImageBoard = (source?: Board): Board => ({
  title: source?.title ?? 'List',
  tiers: source?.tiers.map((tier) => ({ ...tier, itemIds: [] })) ?? defaultBoard().tiers,
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
    return {
      ...parsed.board,
      items: parsed.board.items.map((item) =>
        (item as Item).kind === 'image'
          ? (item as ImageItem)
          : { id: item.id, kind: 'text', label: (item as { label?: string }).label ?? '' },
      ),
    };
  } catch {
    return null;
  }
};

const encodeImageBoard = (board: Board) => JSON.stringify(board);

const decodeImageBoard = (value: string | null): Board | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Board;
    return {
      ...parsed,
      items: parsed.items
        .filter((item): item is ImageItem => Boolean(item) && (item as Item).kind === 'image')
        .map((item) => ({ ...item, kind: 'image' as const })),
    };
  } catch {
    return null;
  }
};

const IMAGE_ITEM_SIZE = 1024;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.crossOrigin = 'anonymous';
    image.src = src;
  });

const imageBlobToSquareDataUrl = async (blob: Blob) => {
  const source = URL.createObjectURL(blob);
  try {
    const image = await loadImage(source);
    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_ITEM_SIZE;
    canvas.height = IMAGE_ITEM_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return await blobToDataUrl(blob);

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - sourceSize) / 2;
    const sy = (image.naturalHeight - sourceSize) / 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, IMAGE_ITEM_SIZE, IMAGE_ITEM_SIZE);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(source);
  }
};

const normalizeImageSource = async (value: string) => {
  if (value.startsWith('data:')) {
    const response = await fetch(value);
    return imageBlobToSquareDataUrl(await response.blob());
  }

  try {
    const url = new URL(value, window.location.href).toString();
    const response = await fetch(url);
    if (!response.ok) return url;
    return await imageBlobToSquareDataUrl(await response.blob());
  } catch {
    return value;
  }
};

const fileToDataUrl = async (file: File) => imageBlobToSquareDataUrl(file);

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

const measureTierTitleWidth = (titles: string[]) => {
  const widest = titles.reduce((max, title) => Math.max(max, title.length), 0);
  return Math.max(1, widest);
};

const getInitialTheme = (): Theme => {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function App() {
  const [textBoard, setTextBoard] = useState<Board>(() => decodeState(new URLSearchParams(window.location.hash.slice(1)).get('s')) ?? defaultTextBoard());
  const [imageBoard, setImageBoard] = useState<Board>(() => decodeImageBoard(window.sessionStorage.getItem(IMAGE_BOARD_STORAGE_KEY)) ?? defaultImageBoard());
  const [mode, setMode] = useState<Mode>(() => {
    const stored = window.sessionStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'image' ? 'image' : 'text';
  });
  const [imageBoardInitialized, setImageBoardInitialized] = useState(() => Boolean(window.sessionStorage.getItem(IMAGE_BOARD_STORAGE_KEY)));
  const [newItemValue, setNewItemValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const boardRef = React.useRef<HTMLElement | null>(null);
  const board = mode === 'text' ? textBoard : imageBoard;
  const setBoard = mode === 'text' ? setTextBoard : setImageBoard;
  const tierTitleWidth = useMemo(() => measureTierTitleWidth(board.tiers.map((tier) => tier.title)), [board.tiers]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
  );

  useEffect(() => {
    if (mode !== 'text') return;
    const encoded = encodeState({ v: STORAGE_VERSION, board: textBoard });
    const url = new URL(window.location.href);
    url.hash = `s=${encoded}`;
    window.history.replaceState(null, '', url.toString());
  }, [board, mode, textBoard]);

  useEffect(() => {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.sessionStorage.setItem(IMAGE_BOARD_STORAGE_KEY, encodeImageBoard(imageBoard));
  }, [imageBoard]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    document.title = 'tear';
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const itemMap = useMemo(() => new Map(board.items.map((item) => [item.id, item])), [board.items]);
  const hasTierItems = board.tiers.some((tier) => tier.itemIds.length > 0);

  const syncImageBoardFromText = () => {
    if (imageBoardInitialized) return;
    setImageBoard(defaultImageBoard(textBoard));
    setImageBoardInitialized(true);
  };

  const switchMode = (nextMode: Mode) => {
    if (nextMode === 'image') syncImageBoardFromText();
    setMode(nextMode);
  };

  const addTextItems = () => {
    const labels = newItemValue
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);

    if (!labels.length) return;

    setTextBoard((current) => ({
      ...current,
      items: [...current.items, ...labels.map((label) => ({ id: createId(), kind: 'text', label }))],
    }));
    setNewItemValue('');
  };

  const addImageItem = async (src: string, name?: string) => {
    const normalized = await normalizeImageSource(src);
    setImageBoard((current) => ({
      ...current,
      items: [...current.items, { id: createId(), kind: 'image', src: normalized, name }],
    }));
    setNewItemValue('');
    setFileInputKey((current) => current + 1);
  };

  const onBrowseImages = () => fileInputRef.current?.click();

  const onFilesSelected = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;

    const images = await Promise.all(
      selectedFiles.map(async (file) => ({
        id: createId(),
        kind: 'image' as const,
        src: await fileToDataUrl(file),
        name: file.name,
      })),
    );

    setImageBoard((current) => ({
      ...current,
      items: [...current.items, ...images],
    }));
    setNewItemValue('');
    setFileInputKey((current) => current + 1);
  };

  const onAddItem = async () => {
    if (mode === 'text') {
      addTextItems();
      return;
    }

    const value = newItemValue.trim();
    if (!value) return;
    await addImageItem(value);
  };

  const onAddTier = () => {
    setBoard((current) => ({
      ...current,
      tiers: [...current.tiers, { id: createId(), title: `Tier ${current.tiers.length + 1}`, itemIds: [] }],
    }));
  };

  const onReturnAllItems = () => {
    setBoard((current) => ({
      ...current,
      tiers: current.tiers.map((tier) => ({ ...tier, itemIds: [] })),
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
        scale: Math.max(3, window.devicePixelRatio || 1),
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

  const onReset = () => {
    if (!window.confirm('Reset the tier list and start over?')) return;
    window.sessionStorage.removeItem(MODE_STORAGE_KEY);
    window.sessionStorage.removeItem(IMAGE_BOARD_STORAGE_KEY);
    window.location.assign(new URL(import.meta.env.BASE_URL, window.location.href).toString());
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
              onChange={(event) => {
                const title = event.target.value;
                setTextBoard((current) => ({ ...current, title }));
                setImageBoard((current) => ({ ...current, title }));
              }}
            />
            <div className="mode-switch" role="tablist" aria-label="Board mode">
              <button className={mode === 'text' ? 'active' : ''} type="button" onClick={() => switchMode('text')} aria-pressed={mode === 'text'}>
                Text
              </button>
              <button className={mode === 'image' ? 'active' : ''} type="button" onClick={() => switchMode('image')} aria-pressed={mode === 'image'}>
                Images
              </button>
            </div>
          </div>
          <div className="actions">
            <div className="actions-top">
              <button onClick={onDownloadPng} disabled={exporting}>{exporting ? 'Saving...' : 'Save'}</button>
              {mode === 'text' ? <button onClick={onCopyLink}>{copied ? 'Link copied' : 'Share'}</button> : null}
              <a className="site-mark-link" href="https://github.com/tinykings/tear" target="_blank" rel="noreferrer" aria-label="tear on GitHub">
                <img className="site-mark" src={logoUrl} alt="tear" />
              </a>
            </div>
          </div>
        </header>

        <main ref={boardRef} className="board">
          {board.tiers.map((tier, index) => (
            <TierRow
              key={tier.id}
              tier={tier}
              tierIndex={index}
              titleWidth={tierTitleWidth}
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

          <div className="add-tier-row">
            <button className="add-tier-button" type="button" onClick={onAddTier}>
              <span className="add-tier-plus" aria-hidden="true">
                +
              </span>
              <span>Add tier</span>
            </button>
            {hasTierItems ? (
              <button className="add-tier-return" type="button" onClick={onReturnAllItems}>
                Return items
              </button>
            ) : null}
          </div>

          <Pool items={board.items.filter((item) => !board.tiers.some((tier) => tier.itemIds.includes(item.id)))} activeItemId={activeItemId} />

          <section className="composer">
            <input
              value={newItemValue}
              placeholder={mode === 'text' ? 'Add items, comma separated' : 'Paste image URL'}
              onChange={(event) => setNewItemValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void onAddItem();
                }
              }}
            />
            <div className="composer-actions">
              <button onClick={() => void onAddItem()}>{mode === 'text' ? 'Add item' : 'Add image'}</button>
              {activeItemId ? <TrashCan activeItemId={activeItemId} inline /> : null}
            </div>
            {mode === 'image' ? (
              <>
                <button type="button" onClick={onBrowseImages}>
                  Browse
                </button>
                <input key={fileInputKey} ref={fileInputRef} className="hidden-file-input" type="file" accept="image/*" multiple onChange={(event) => void onFilesSelected(event.currentTarget.files)} />
              </>
            ) : null}
          </section>
        </main>

        <button className="reset-button" type="button" onClick={onReset}>
          RESET
        </button>

        <button
          className="theme-button"
          type="button"
          onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
        </button>
      </div>
    </DndContext>
  );
}

function TierRow({ tier, tierIndex, titleWidth, items, onTitleChange, onRemove, onMoveUp, onMoveDown, activeItemId }: { tier: Tier; tierIndex: number; titleWidth: number; items: Item[]; onTitleChange: (title: string) => void; onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void; activeItemId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: `tier:${tier.id}` });
  const chipStyle = { '--chip-color': tierColors[tierIndex % tierColors.length] } as React.CSSProperties;
  const itemCount = items.length;

  return (
    <section ref={setNodeRef} className={`tier-row ${isOver ? 'over' : ''}`}>
      <div className="tier-label">
        <input maxLength={12} style={{ width: `calc(${titleWidth + 4}ch + 28px)` }} value={tier.title} onChange={(event) => onTitleChange(event.target.value)} />
        <div className="tier-meta">
          <span className="tier-count" aria-label={`${itemCount} items in ${tier.title}`}>
            {itemCount}
          </span>
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
        </div>
      </div>
      <div className="tier-items">
        {items.map((item) => (
          <DraggableItem key={item.id} item={item} active={activeItemId === item.id} style={chipStyle} />
        ))}
      </div>
    </section>
  );
}

function Pool({ items, activeItemId }: { items: Item[]; activeItemId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });

  return (
    <section ref={setNodeRef} className={`pool ${isOver ? 'over' : ''}`}>
      <div className="pool-header">
        <div className="pool-header-copy">
          <h2>Items</h2>
          <span>{items.length}</span>
        </div>
      </div>
      <div className="tier-items">
        {items.map((item) => (
          <DraggableItem key={item.id} item={item} active={activeItemId === item.id} style={{ '--chip-color': '#b8b1a6' } as React.CSSProperties} />
        ))}
      </div>
    </section>
  );
}

function TrashCan({ activeItemId, inline = false }: { activeItemId: string | null; inline?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash' });

  return (
    <section ref={setNodeRef} className={`trash-can ${inline ? 'inline' : ''} ${isOver && activeItemId ? 'over' : ''}`}>
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
  const className = `item-chip ${item.kind === 'image' ? 'image-item' : ''} ${active || isDragging ? 'dragging' : ''}`;
  const itemStyle =
    item.kind === 'image'
      ? ({
          ...style,
          ...transformStyle,
          backgroundImage: `url(${item.src})`,
        } as React.CSSProperties)
      : transformStyle
        ? { ...style, ...transformStyle }
        : style;

  return (
    <button
      ref={setNodeRef}
      className={className}
      style={itemStyle}
      {...listeners}
      {...attributes}
      aria-label={item.kind === 'image' ? item.name ?? 'Image item' : item.label}
    >
      {item.kind === 'image' ? null : item.label}
    </button>
  );
}

export { App };
