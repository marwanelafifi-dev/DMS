import { HistoricalPcarRegister } from './HistoricalPcarRegister';
import { usePageAccess } from '../../hooks/usePageAccess';

export function HistoricalPcarPage() {
  const access = usePageAccess();
  return <div>
    <h1 className="page-heading">Historical PCAR Archive</h1>
    <p className="page-subtitle">Search historical PCAR records and, when needed, assign eligible open records back into the live PCAR workflow.</p>
    <HistoricalPcarRegister
      canImport={access?.canImportHistoricalPcars ?? false}
      canPromote={Boolean(access?.canImportHistoricalPcars && access?.canManageAllTasks)}
    />
  </div>;
}
