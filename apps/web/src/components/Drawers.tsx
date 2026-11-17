import { useEffect, useRef, useState, type ReactNode } from "react";
import { Highlighter, X } from "lucide-react";
import { api, type FeedbackKind, type Note } from "../api";
import { useApp } from "../state";
import { term } from "../content/glossary";
import { useDraft } from "../persist";

/** `open` = no dimming backdrop, so the page under the drawer stays usable (e.g. to select text). */
export function Drawer({ side = "right", label, onClose, children, open = false }: { side?: "right" | "left"; label: string; onClose: () => void; children: ReactNode; open?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {!open && <div className="scrim" onClick={onClose} />}
      <aside className={`drawer${side === "left" ? " left" : ""}`} aria-label={label}>
        <div className="drawer-h"><span className="eyebrow">{label}</span><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button></div>
        {children}
      </aside>
    </>
  );
}

function NoteBox({ q, onSaved }: { q: { topic_id?: string; term_id?: string }; onSaved?: () => void }) {
  const [text, setText, clearText] = useDraft(`draft:note:${q.term_id ?? q.topic_id ?? "-"}`, "");
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Своими словами, чтобы потом быстро вспомнить" />
      <button className="btn sm" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={async () => { await api.addNote({ ...q, text }); clearText(); onSaved?.(); }}>Сохранить заметку</button>
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
// Highlighted fragments are drawn with the CSS Custom Highlight API: nothing in the lesson DOM changes,
// and removing the highlight is just deleting it from the registry.
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = (): HighlightRegistry | null => (typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: HighlightRegistry }).highlights : null);
const HL = "fb-mark";
function paint(ranges: Range[]) {
  const reg = registry();
  if (!reg) return;
  if (ranges.length) reg.set(HL, new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...ranges));
  else reg.delete(HL);
}

export function FeedbackDrawer({ topicId, page, onClose }: { topicId?: string; page?: number; onClose: () => void }) {
  const [kind, setKind] = useDraft<FeedbackKind>(`draft:feedback-kind:${topicId ?? "-"}`, "content_issue");
  const [text, setText, clearText] = useDraft(`draft:feedback:${topicId ?? "-"}`, "");
  const [sent, setSent] = useState(false);
  const [picking, setPicking] = useState(false);
  const [marks, setMarks] = useState<{ range: Range; text: string }[]>([]);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  useEffect(() => { paint(marks.map((m) => m.range)); }, [marks]);
  useEffect(() => () => paint([]), []); // closing or sending removes the marker
  // while highlighting, the lesson moves out from under the drawer so all of its text can be selected
  const side = picking || marks.length > 0;
  useEffect(() => {
    document.body.classList.toggle("drawer-side", side);
    return () => document.body.classList.remove("drawer-side");
  }, [side]);

  useEffect(() => {
    if (!picking) return;
    const onUp = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const host = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest(".read");
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (!host || !quote) return;
      setMarks([...marksRef.current, { range: range.cloneRange(), text: quote }]);
      sel.removeAllRanges();
      setPicking(false);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => { document.removeEventListener("mouseup", onUp); document.removeEventListener("touchend", onUp); };
  }, [picking]);

  const canSend = !!text.trim();
  async function send() {
    await api.feedback(kind, text, topicId, marks.map((m) => m.text).join("\n\n"), page);
    setMarks([]);
    clearText();
    setSent(true);
  }

  return (
    <Drawer label="Предложить правку" onClose={onClose} open={picking || marks.length > 0}>
      {sent ? <p>Спасибо — замечание записано. Оно попадёт в список доработок курса.</p> : (
        <>
          <p className="muted">Это сообщение о самом курсе: где непонятно объяснено, где ошибка, чего не хватает. Вопросы по теме лучше задавать преподавателю.</p>
          {KINDS.map(([k, label]) => (
            <button key={k} className={`opt${kind === k ? " right" : ""}`} onClick={() => setKind(k)}><input type="radio" readOnly checked={kind === k} tabIndex={-1} />{label}</button>
          ))}
          <div className="fb-marks">
            <button className={`btn soft sm${picking ? " active" : ""}`} onClick={() => setPicking(!picking)}><Highlighter size={16} />{picking ? "Выделите текст в уроке…" : marks.length ? "Выделить ещё фрагмент" : "Выделить фрагмент"}</button>
            {picking && <p className="faint">Выделите мышью нужное место на странице — оно подсветится маркером.</p>}
            {marks.map((m, i) => (
              <div key={i} className="fb-quote">
                <span>«{m.text.length > 160 ? `${m.text.slice(0, 160)}…` : m.text}»</span>
                <button className="icon-btn" aria-label="Убрать выделение" onClick={() => setMarks(marks.filter((_, j) => j !== i))}><X size={15} /></button>
              </div>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Что не так и как лучше" style={{ marginTop: 6 }} />
          <button className="btn sm" style={{ marginTop: 10 }} disabled={!canSend} onClick={send}>Отправить</button>
        </>
      )}
    </Drawer>
  );
}
