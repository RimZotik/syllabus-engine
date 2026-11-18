// Which learning package the open page is about: the first segment of the address, /<package>/learn/…
// Set once per package by the root (the whole app below it remounts when the package changes), read by
// the API client (X-Syllabus-Package header), the content registry, the glossary and links.
let current = "";

export const setCurrentPackage = (id: string) => { current = id; };
export const currentPackage = () => current;

/** An address inside the current package: to("/learn/intro1.what.1") → "/ml-bigdata-ai/learn/intro1.what.1". */
export const to = (path = "") => `/${current}${path}`;

/** Addresses that are not package ids (old links without a package, and the platform's own paths). */
export const RESERVED = ["learn", "test", "record", "trainer", "reference", "api", "assets", "pyodide", "src", "node_modules", "@fs", "@vite", "@id"];
