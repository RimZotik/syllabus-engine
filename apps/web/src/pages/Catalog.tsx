import { Link } from "react-router-dom";
import { icons, type LucideIcon } from "lucide-react";
import type { Package } from "../api";

/** "book-open" → the lucide BookOpen icon; an unknown name falls back to a book. */
export function PackageIcon({ name, size = 22 }: { name: string; size?: number }) {
  const key = name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") as keyof typeof icons;
  const Icon: LucideIcon = icons[key] ?? icons.BookOpen;
  return <Icon size={size} />;
}

/** The platform's front page when more than one learning package is installed: one card per package. */
export function Catalog({ packages }: { packages: Package[] }) {
  return (
    <div className="wrap catalog">
      <div className="eyebrow">Syllabus Engine</div>
      <h1>Обучения</h1>
      <p className="muted">Выберите обучение. У каждого свой учебный план, прогресс и зачётка.</p>
      <div className="catalog-grid">
        {packages.map((p) => (
          <Link key={p.id} to={`/${p.id}`} className={`pkg-card c-${p.color}`}>
            <span className="pkg-icon"><PackageIcon name={p.icon} /></span>
            <b>{p.title}</b>
            {p.subtitle && <span className="pkg-sub">{p.subtitle}</span>}
            <span className="pkg-summary">{p.summary}</span>
            <span className="pkg-meta">{[p.level, p.author.name, p.version && `версия ${p.version}`].filter(Boolean).join(" · ")}</span>
            {p.tags.length > 0 && <span className="pkg-tags">{p.tags.map((t) => <span key={t} className="chip">{t}</span>)}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
