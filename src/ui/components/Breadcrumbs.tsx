import { navigate } from '../router.tsx';
import { Icon } from '../icons.tsx';

interface Crumb {
  label: string;
  path?: string;
}

const PARENT_MAP: Record<string, Crumb[]> = {
  '/app/workflows/': [{ label: 'Build', path: '/app/build' }, { label: 'Workflows', path: '/app/workflows' }],
  '/app/skills': [{ label: 'Build', path: '/app/build' }],
  '/app/routines': [{ label: 'Build', path: '/app/build' }],
  '/app/crew': [{ label: 'Build', path: '/app/build' }],
  '/app/tools': [{ label: 'Build', path: '/app/build' }],
  '/app/memory': [{ label: 'More', path: '/app/more' }],
  '/app/ideas': [{ label: 'More', path: '/app/more' }],
  '/app/traces': [{ label: 'More', path: '/app/more' }],
  '/app/modes': [{ label: 'More', path: '/app/more' }],
  '/app/assistant': [{ label: 'More', path: '/app/more' }],
  '/app/cloud': [{ label: 'More', path: '/app/more' }],
  '/app/settings': [{ label: 'More', path: '/app/more' }],
  '/app/providers': [{ label: 'More', path: '/app/more' }],
  '/app/diagnostics': [{ label: 'More', path: '/app/more' }],
  '/app/help': [{ label: 'More', path: '/app/more' }],
  '/app/library': [{ label: 'Workspace' }],
  '/app/weather': [{ label: 'Workspace' }],
  '/app/calendar': [{ label: 'Workspace' }],
};

export function Breadcrumbs({ route }: { route: string }) {
  // Find parent chain
  let crumbs: Crumb[] = [];
  for (const [prefix, chain] of Object.entries(PARENT_MAP)) {
    if (route.startsWith(prefix)) {
      crumbs = chain;
      break;
    }
  }
  if (route.startsWith('/app/workflows/') && route !== '/app/workflows') {
    // Add current workflow id as non-link crumb
    crumbs = [...crumbs, { label: route.split('/').pop() || 'Editor' }];
  }
  if (!crumbs.length) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', marginBottom: 10 }}>
      <button type="button" className="chip" onClick={() => navigate('/app')} style={{ padding: '2px 8px' }}>
        <Icon name="home" size={12} /> Home
      </button>
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="chevron" size={10} />
          {c.path ? (
            <button type="button" className="chip" onClick={() => navigate(c.path!)} style={{ padding: '2px 8px' }}>
              {c.label}
            </button>
          ) : (
            <span className="pill" style={{ fontSize: '0.78rem' }}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
