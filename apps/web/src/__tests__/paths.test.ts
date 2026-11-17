import { describe, expect, it } from "vitest";
import { sectionIdOf, topicIdOf } from "../content/paths";

describe("topic and section ids from package paths", () => {
  it("reads a topic id from any key prefix", () => {
    expect(topicIdOf("../../../../content/forge-ml/courses/0/intro1/what/02-four-words/topic.mdx")).toBe("intro1.what.2");
    expect(topicIdOf("/content/drawing/courses/I/draw1/line/10-hatching/quiz.yaml")).toBe("draw1.line.10");
  });
  it("is not confused by a package, section or course named «courses»", () => {
    expect(topicIdOf("/content/courses/courses/I/d1/courses/01-a/topic.mdx")).toBe("d1.courses.1");
    expect(sectionIdOf("/content/courses/courses/I/d1/courses/test.yaml")).toBe("d1.courses");
  });
  it("accepts Windows separators", () => {
    expect(topicIdOf(String.raw`C:\repo\content\x\courses\I\d\s\03-t\topic.mdx`)).toBe("d.s.3");
  });
  it("explains a topic folder without a number", () => {
    expect(() => topicIdOf("/content/x/courses/I/d/s/intro/topic.mdx")).toThrow(/номера/);
  });
});
