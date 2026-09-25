import { useState } from 'react';
import { Icon } from '../icons.tsx';
import type { MemoryItem } from '../../core/types.ts';
import { navigate } from '../router.tsx';

export function MemoryUsedDisclosure({ items }: { items: MemoryItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="card tight" style={{ marginTop: 8, borderStyle: 'dashed' }}>
      <button
        type="button"
        className="row"
        style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', gap: 8, textAlign: 'left' }}
        onClick={() => setOpen(!open)}
      >
        <Icon name="memory" size={14} />
        <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Memories used ({items.length})</span>
        <span className="grow" />
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {open && (
        <div className="stack sm" style={{ marginTop: 10 }}>
          {items.map(m => (
            <div key={m.id} className="row" style={{ gap: 8, fontSize: '0.84rem', alignItems: 'flex-start' }}>
              <Icon name={m.pinned ? 'pin' : 'info'} size={12} />
              <span className="grow" style={{ whiteSpace: 'normal' }}>{m.text}</span>
              <button className="chip" style={{ padding: '2px 6px', fontSize: '0.72rem' }} onClick={() => navigate('/app/memory')}>Edit</button>
            </div>
          ))}
          <p className="muted" style={{ fontSize: '0.76rem', margin: '6px 0 0' }}>
            These facts were injected into the prompt. Pin important ones, delete wrong ones in Memory.
          </p>
        </div>
      )}
    </div>
  );
}
