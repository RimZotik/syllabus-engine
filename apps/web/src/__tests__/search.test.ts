import { describe, expect, it } from "vitest";
import { score } from "../content/match";

describe("reference search score", () => {
  it("puts the exact word above a word that only shares the stem", () => {
    expect(score("класс", "Классификация")).toBe(4);
    expect(score("класс", "Кластеризация")).toBeLessThan(score("класс", "Классификация"));
  });
  it("finds other word forms by the stem", () => {
    expect(score("классы", "Задача классификации")).toBe(2);
  });
  it("ranks a title match above a text match", () => {
    expect(score("перцептрон", "Машина, которая учится", "Перцептрон Розенблатта")).toBe(1);
    expect(score("перцептрон", "Перцептрон")).toBe(4);
  });
  it("needs every word and matches only at word starts", () => {
    expect(score("скрытый слой", "Скрытый слой")).toBe(4);
    expect(score("скрытый слой", "Скрытый нейрон")).toBe(0);
    expect(score("лой", "Слой")).toBe(0);
    expect(score("  ", "Слой")).toBe(0);
    expect(score("слой", "Четыре главных слова", "ИИ простыми словами")).toBe(0);
  });
});
