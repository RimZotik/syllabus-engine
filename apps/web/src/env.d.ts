/// <reference types="vite/client" />

declare module "*.yaml" {
  const data: unknown;
  export default data;
}

/** Built by vite.config.ts: every <Theorem> of every topic, for the «Справочник» search. */
declare module "virtual:theorems" {
  const index: { pkg: string; topicId: string; kind: "definition" | "theorem" | "rule"; title: string; text: string }[];
  export default index;
}
