import { describe, expect, it } from "vitest";
import { fences } from "../components/TraceView";

describe("Trace reads code and input from fenced blocks inside it", () => {
  it("keeps indentation exactly and separates code from input", () => {
    // what MDX produces for ```python … ``` and ```input … ``` inside <Trace>
    const children = [
      <pre key="1"><code className="language-python">{"for t in [1, 2]:\n    if t > 1:\n        print(t)\n"}</code></pre>,
      <pre key="2"><code className="language-input">{"молоко\nхлеб\n\n"}</code></pre>,
    ];
    const blocks = fences(children);
    expect(blocks).toEqual([
      { lang: "python", text: "for t in [1, 2]:\n    if t > 1:\n        print(t)\n" },
      { lang: "input", text: "молоко\nхлеб\n\n" },
    ]);
  });
  it("finds blocks nested in other elements and code without a language", () => {
    const blocks = fences(<div><pre><code>{"x = 1"}</code></pre></div>);
    expect(blocks).toEqual([{ lang: "", text: "x = 1" }]);
  });
});
