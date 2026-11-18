import { currentPackage } from "../current";

const files = import.meta.glob<{ default: Term[] | null }>("../../../../courses/*/glossary.yaml", { eager: true });

export type Term = { id: string; term: string; en?: string; decode?: string; short: string; example?: string; introduced_in?: string };

const byPkg = new Map<string, Map<string, Term>>();
for (const [path, mod] of Object.entries(files)) {
  const pkg = path.replace(/\\/g, "/").split("/").slice(-2)[0];
  byPkg.set(pkg, new Map(((mod.default ?? []) as Term[]).filter(Boolean).map((t) => [t.id, t])));
}

/** All terms of the open package, in glossary order. */
export const allTerms = (): Term[] => [...(byPkg.get(currentPackage())?.values() ?? [])];

export function term(id: string): Term | undefined {
  return byPkg.get(currentPackage())?.get(id);
}
