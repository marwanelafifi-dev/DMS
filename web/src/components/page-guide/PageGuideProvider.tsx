import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePageAccess } from '../../hooks/usePageAccess';
import { PageGuideModal } from './PageGuideModal';
import { resolveGuide, selectVisibleSections, type GuideDefinition } from './guideRegistry';

const STORAGE_PREFIX = 'dms.pageGuides.seen.';

interface PageGuideContextValue {
  openCurrentGuide: () => void;
  hasCurrentGuide: boolean;
}
const PageGuideContext = createContext<PageGuideContextValue | null>(null);

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}
function readSeenVersions(userId: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function markSeen(userId: string, guide: GuideDefinition) {
  try {
    const seen = readSeenVersions(userId);
    seen[guide.key] = Math.max(seen[guide.key] ?? 0, guide.version);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(seen));
  } catch {
    // Storage-disabled browsers retain the session behavior without breaking the app.
  }
}

function canUserSeeGuide(guide: GuideDefinition, access: ReturnType<typeof usePageAccess>): boolean {
  if (!guide.enabled || guide.commonSections.length === 0 || access === null) return false;
  return !guide.requiredAccess || access[guide.requiredAccess] === true;
}

export function PageGuideProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const access = usePageAccess();
  const routeGuide = useMemo(() => resolveGuide(location.pathname), [location.pathname]);
  const currentGuide = routeGuide && canUserSeeGuide(routeGuide, access) ? routeGuide : null;
  const visibleSections = useMemo(
    () => currentGuide && access ? selectVisibleSections(currentGuide, access) : [],
    [currentGuide, access],
  );
  const [open, setOpen] = useState(false);
  const [activeGuide, setActiveGuide] = useState<GuideDefinition | null>(null);
  const [openedAutomatically, setOpenedAutomatically] = useState(false);
  const lastEvaluatedIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!currentGuide || !user || access === null) {
      lastEvaluatedIdentity.current = null;
      setOpen(false);
      setActiveGuide(null);
      setOpenedAutomatically(false);
      return;
    }

    const identity = `${user.userId}:${currentGuide.key}:${currentGuide.version}`;
    if (lastEvaluatedIdentity.current === identity) return;
    lastEvaluatedIdentity.current = identity;

    const seen = readSeenVersions(user.userId);
    if ((seen[currentGuide.key] ?? 0) < currentGuide.version) {
      setActiveGuide(currentGuide);
      setOpenedAutomatically(true);
      setOpen(true);
    } else {
      setOpen(false);
      setActiveGuide(null);
      setOpenedAutomatically(false);
    }
  }, [access, currentGuide, user]);

  const closeGuide = useCallback(() => {
    if (openedAutomatically && activeGuide && user) markSeen(user.userId, activeGuide);
    setOpen(false);
    setOpenedAutomatically(false);
  }, [activeGuide, openedAutomatically, user]);

  const openCurrentGuide = useCallback(() => {
    if (!currentGuide) return;
    setActiveGuide(currentGuide);
    setOpenedAutomatically(false);
    setOpen(true);
  }, [currentGuide]);

  const value = useMemo<PageGuideContextValue>(() => ({
    openCurrentGuide,
    hasCurrentGuide: currentGuide !== null,
  }), [currentGuide, openCurrentGuide]);

  const modalSections = activeGuide?.key === currentGuide?.key ? visibleSections : [];

  return (
    <PageGuideContext.Provider value={value}>
      {children}
      <PageGuideModal
        open={open && activeGuide !== null && modalSections.length > 0}
        guide={activeGuide}
        sections={modalSections}
        onClose={closeGuide}
        onGotIt={closeGuide}
      />
    </PageGuideContext.Provider>
  );
}

export function usePageGuide(): PageGuideContextValue {
  const context = useContext(PageGuideContext);
  if (!context) throw new Error('usePageGuide must be used within a PageGuideProvider');
  return context;
}
