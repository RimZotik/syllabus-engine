import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../components/RichText";

const html = (text: string, block = false) => renderToStaticMarkup(<RichText text={text} block={block} />);

describe("RichText — text from YAML with code", () => {
  it("renders inline code", () => {
    expect(html("Что выведет `print(2 + 3)`?")).toBe("Что выведет <code>print(2 + 3)</code>?");
  });
  it("renders a fenced block with its line breaks and no language tag", () => {
    const out = html("Что выведет программа?\n```python\nx = 5\ny = x\nprint(y)\n```");
    expect(out).toContain('<pre class="rt-pre"><code>x = 5\ny = x\nprint(y)</code></pre>');
    expect(out).toContain("Что выведет программа?");
  });
  it("keeps single line breaks and splits paragraphs in block mode", () => {
    expect(html("строка 1\nстрока 2")).toBe("строка 1<br/>строка 2");
    expect(html("абзац 1\n\nабзац 2", true)).toBe("<p>абзац 1</p><p>абзац 2</p>");
  });
  it("leaves a lone backtick alone and escapes markup", () => {
    expect(html("знак ` и <b>")).toBe("знак ` и &lt;b&gt;");
  });
});
