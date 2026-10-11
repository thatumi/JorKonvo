// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { initCustomCss, useCustomCssStore } from "../../../apps/web/src/lib/customCss.js";

const KEY = "jorkonvo-custom-css";

beforeEach(() => {
  localStorage.clear();
  document.getElementById("jorkonvo-custom-css")?.remove();
  useCustomCssStore.setState({ css: "" });
});

describe("custom CSS store", () => {
  it("setCss persists to localStorage and injects a <style> element", () => {
    useCustomCssStore.getState().setCss(".x { color: red }");
    expect(localStorage.getItem(KEY)).toBe(".x { color: red }");
    const el = document.getElementById("jorkonvo-custom-css") as HTMLStyleElement;
    expect(el?.textContent).toBe(".x { color: red }");
    expect(useCustomCssStore.getState().css).toBe(".x { color: red }");
  });

  it("clearing the CSS removes both the storage key and the style element", () => {
    useCustomCssStore.getState().setCss(".x { color: red }");
    useCustomCssStore.getState().setCss("   ");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.getElementById("jorkonvo-custom-css")).toBeNull();
  });

  it("initCustomCss re-applies previously saved CSS on boot", () => {
    localStorage.setItem(KEY, "body { background: black }");
    initCustomCss();
    expect(document.getElementById("jorkonvo-custom-css")?.textContent).toBe("body { background: black }");
  });
});
