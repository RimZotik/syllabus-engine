import raw from "@pkg/glossary.yaml";

export type Term = { id: string; term: string; en?: string; decode?: string; short: string; example?: string; introduced_in?: string };

const list = ((raw as Term[] | null) ?? []).filter(Boolean);
const byId = new Map(list.map((t) => [t.id, t]));

export function term(id: string): Term | undefined {
  return byId.get(id);
}
