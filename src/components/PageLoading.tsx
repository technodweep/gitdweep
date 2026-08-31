export function PageLoading({
  label,
  rows = 2,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-label">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="page-loading-row" aria-hidden="true" key={index}>
          <span className="page-loading-line page-loading-line-title" />
          <span className="page-loading-line" />
          <span className="page-loading-line page-loading-line-short" />
        </div>
      ))}
    </div>
  );
}
