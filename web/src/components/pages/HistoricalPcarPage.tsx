import { HistoricalPcarRegister } from './HistoricalPcarRegister';
import { usePageAccess } from '../../hooks/usePageAccess';

export function HistoricalPcarPage() {
  const access = usePageAccess();
  return <div>
    <h1 className="page-heading">Historical PCAR Archive</h1>
    <p className="page-subtitle">Search and review closed PCAR history from the previous system.</p>
    <HistoricalPcarRegister canImport={access?.canImportHistoricalPcars ?? false} />
  </div>;
}
