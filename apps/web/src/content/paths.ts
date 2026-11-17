// Topic and section ids from file paths inside a package. The depth is fixed, so paths are read
// from the end — whatever the package folder or the glob key prefix looks like:
//   courses/<course>/<discipline>/<section>/<NN-slug>/topic.mdx | quiz.yaml  → "<discipline>.<section>.<NN>"
//   courses/<course>/<discipline>/<section>/test.yaml                        → "<discipline>.<section>"

const segs = (path: string) => path.replace(/\\/g, "/").split("/");

export function topicIdOf(path: string): string {
  const [disc, section, folder] = segs(path).slice(-4, -1);
  const n = parseInt(folder, 10);
  if (!disc || !section || Number.isNaN(n)) throw new Error(`Не удаётся понять тему по пути ${path}: папка темы должна начинаться с номера, например 01-intro`);
  return `${disc}.${section}.${n}`;
}

export function sectionIdOf(path: string): string {
  const [disc, section] = segs(path).slice(-3, -1);
  return `${disc}.${section}`;
}
