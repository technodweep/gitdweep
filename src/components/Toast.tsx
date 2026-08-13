import { Icon } from "./Icon";

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
      <span className="toast-icon">
        <Icon name={error ? "x" : "check"} size={16} />
      </span>
      <div className="toast-message">{message}</div>
      <div className="toast-actions">
        <button className="icon-btn" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
