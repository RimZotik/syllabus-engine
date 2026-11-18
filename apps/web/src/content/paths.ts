// Topic and section ids from file paths inside a package. The depth is fixed, so paths are read
// from the end — whatever the package folder or the glob key prefix looks like:
//   lessons/<discipline>/<section>/<NN-slug>/topic.mdx | quiz.yaml  → "<discipline>.<section>.<NN>"
//   lessons/<discipline>/<section>/test.yaml                        → "<discipline>.<section>"

const segs = (path: string) => path.replace(/\\/g, "/").split("/");

export function topicIdOf(path: string): string {
  const [disc, section, folder] = segs(path).slice(-4, -1);
  const n = parseInt(folder, 10);
  if (!disc || !section || Number.isNaN(n)) throw new Error(`Не удаётся понять тему по пути ${path}: папка темы должна начинаться с номера, например 01-intro`);
  return `${disc}.${section}.${n}`;
}

/**
 * The package folder of a lesson file found by a glob over @courses — again counted from the end:
 *   <package>/lessons/<d>/<s>/<NN>/topic.mdx | quiz.yaml   → 6th from the end
 *   <package>/lessons/<d>/<s>/test.yaml                    → 5th
 *   <package>/lessons/<d>/<s>/<NN>/tasks/<id>/task.yaml    → 8th
 */
export function packageOf(path: string): string {
  const s = segs(path);
  const file = s[s.length - 1];
  const depth = file === "test.yaml" ? 5 : file === "task.yaml" ? 8 : 6;
  return s[s.length - depth] ?? "";
}

export function sectionIdOf(path: string): string {
  const [disc, section] = segs(path).slice(-3, -1);
  return `${disc}.${section}`;
}
