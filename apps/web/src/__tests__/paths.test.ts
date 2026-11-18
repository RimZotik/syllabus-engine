import { describe, expect, it } from "vitest";
import { packageOf, sectionIdOf, topicIdOf } from "../content/paths";

describe("topic and section ids from package paths", () => {
  it("reads a topic id from any key prefix", () => {
    expect(topicIdOf("../../../../courses/ml-bigdata-ai/lessons/intro1/what/02-four-words/topic.mdx")).toBe("intro1.what.2");
    expect(topicIdOf("/courses/drawing/lessons/draw1/line/10-hatching/quiz.yaml")).toBe("draw1.line.10");
  });
  it("is not confused by a package or section named like a layout folder", () => {
    expect(topicIdOf("/courses/lessons/lessons/d1/lessons/01-a/topic.mdx")).toBe("d1.lessons.1");
    expect(sectionIdOf("/courses/lessons/lessons/d1/lessons/test.yaml")).toBe("d1.lessons");
  });
  it("accepts Windows separators", () => {
    expect(topicIdOf(String.raw`C:\repo\courses\x\lessons\d\s\03-t\topic.mdx`)).toBe("d.s.3");
  });
  it("explains a topic folder without a number", () => {
    expect(() => topicIdOf("/courses/x/lessons/d/s/intro/topic.mdx")).toThrow(/номера/);
  });
  it("reads the package of every kind of lesson file, whatever its sections are called", () => {
    expect(packageOf("/@fs/B:/repo/courses/ml-bigdata-ai/lessons/intro1/what/02-four-words/topic.mdx")).toBe("ml-bigdata-ai");
    expect(packageOf("/courses/drawing/lessons/d1/lessons/test.yaml")).toBe("drawing");
    expect(packageOf("/courses/drawing/lessons/d1/s/01-a/tasks/t-1/task.yaml")).toBe("drawing");
    expect(packageOf(String.raw`C:\repo\courses\music\lessons\d\s\03-t\quiz.yaml`)).toBe("music");
  });
});
