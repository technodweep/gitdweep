export function Toast({
  message,
  error,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <div className={`toast${error ? " error" : ""}`} role="status">
      <div>{message}</div>
      <div className="actions" style={{ marginTop: "0.5rem" }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
