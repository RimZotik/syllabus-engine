import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { api, type FeedbackKind, type Note } from "../api";
import { useApp } from "../state";
import { term } from "../content/glossary";

export function Drawer({ side = "right", label, onClose, children }: { side?: "right" | "left"; label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer${side === "left" ? " left" : ""}`} aria-label={label}>
        <div className="drawer-h"><span className="eyebrow">{label}</span><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></div>
        {children}
      </aside>
    </>
  );
}

function NoteBox({ q, onSaved }: { q: { topic_id?: string; term_id?: string }; onSaved?: () => void }) {
  const [text, setText] = useState("");
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Своими словами, чтобы потом быстро вспомнить" />
      <button className="btn sm" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={async () => { await api.addNote({ ...q, text }); setText(""); onSaved?.(); }}>Сохранить заметку</button>
    </div>
  );
}

function useNotes(q: { topic_id?: string; term_id?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const key = JSON.stringify(q);
  const reload = () => { api.notes(q).then(setNotes).catch(() => {}); };
  useEffect(reload, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { notes, reload };
}

/** «Справка» — opens on a glossary term click, without leaving the page. */
export function TermDrawer() {
  const { termId, closeTerm } = useApp();
  const { notes, reload } = useNotes({ term_id: termId ?? "" });
  if (!termId) return null;
  const t = term(termId);
  return (
    <Drawer label="Справка" onClose={closeTerm}>
      <h3>{t?.term ?? termId}</h3>
      <div className="decode">{[t?.en, t?.decode, t?.introduced_in && `введено: ${t.introduced_in}`].filter(Boolean).join(" · ")}</div>
      <p>{t?.short ?? "Термина пока нет в глоссарии — это ошибка курса, о ней стоит сообщить."}</p>
      {t?.example && <div className="block"><div className="eyebrow">Пример</div><p>{t.example}</p></div>}
      <div className="block"><div className="eyebrow">Ваши заметки</div>{notes.map((n) => <div className="note" key={n.id}>{n.text}</div>)}<NoteBox q={{ term_id: termId }} onSaved={reload} /></div>
    </Drawer>
  );
}

export function NotesDrawer({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const { notes, reload } = useNotes({ topic_id: topicId });
  return (
    <Drawer label="Заметки к теме" onClose={onClose}>
      {notes.length === 0 && <p className="faint">Заметок пока нет.</p>}
      {notes.map((n) => <div className="note" key={n.id}>{n.text}</div>)}
      <div className="block"><NoteBox q={{ topic_id: topicId }} onSaved={reload} /></div>
    </Drawer>
  );
}

const KINDS: [FeedbackKind, string][] = [["content_issue", "Непонятно или ошибка в материале"], ["idea", "Идея, как сделать лучше"], ["bug", "Что-то не работает"]];

/** Problems with the COURSE itself go to the feedback inbox the author works through. */
export function FeedbackDrawer({ topicId, onClose }: { topicId?: string; onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>("content_issue");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Drawer label="Предложить правку" onClose={onClose}>
      {sent ? <p>Спасибо — замечание записано. Оно попадёт в список доработок курса.</p> : (
        <>
          <p className="muted">Это сообщение о самом курсе: где непонятно объяснено, где ошибка, чего не хватает. Вопросы по теме лучше задавать преподавателю.</p>
          {KINDS.map(([k, label]) => (
            <button key={k} className={`opt${kind === k ? " right" : ""}`} onClick={() => setKind(k)}><input type="radio" readOnly checked={kind === k} tabIndex={-1} />{label}</button>
          ))}
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Что именно и где" style={{ marginTop: 6 }} />
          <button className="btn sm" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={async () => { await api.feedback(kind, text, topicId); setSent(true); }}>Отправить</button>
        </>
      )}
    </Drawer>
  );
}
