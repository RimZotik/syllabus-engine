import { useEffect, type ReactNode } from "react";

/** A confirmation window in the site's style (the browser's confirm() is plain and cannot be styled). Esc or a click outside closes it. */
export function Modal({ title, children, actions, onClose, wide = false }: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
