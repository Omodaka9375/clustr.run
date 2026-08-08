import { describe, it, expect } from "vitest";
import { flattenFolderTree, getTotalFileCount } from "../folder-parser";
import type { ParsedFolder } from "../../core/types";

/** Create a mock ParsedFolder for testing. */
function makeFolder(overrides: Partial<ParsedFolder> = {}): ParsedFolder {
  return {
    name: "test",
    path: "test",
    files: [],
    children: [],
    text: "",
    ...overrides,
  };
}

describe("flattenFolderTree", () => {
  it("returns single folder for flat structure", () => {
    const root = makeFolder({ name: "root", path: "root" });
    const result = flattenFolderTree(root);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("root");
  });

  it("flattens nested folder structure", () => {
    const root = makeFolder({
      name: "root",
      path: "root",
      children: [
        makeFolder({
          name: "child1",
          path: "root/child1",
          children: [
            makeFolder({ name: "grandchild", path: "root/child1/grandchild" }),
          ],
        }),
        makeFolder({ name: "child2", path: "root/child2" }),
      ],
    });

    const result = flattenFolderTree(root);
    expect(result).toHaveLength(4);

    const names = result.map((f) => f.name);
    expect(names).toContain("root");
    expect(names).toContain("child1");
    expect(names).toContain("child2");
    expect(names).toContain("grandchild");
  });

  it("returns folders in depth-first order", () => {
    const root = makeFolder({
      name: "root",
      path: "root",
      children: [
        makeFolder({
          name: "a",
          path: "root/a",
          children: [makeFolder({ name: "a1", path: "root/a/a1" })],
        }),
        makeFolder({ name: "b", path: "root/b" }),
      ],
    });

    const result = flattenFolderTree(root);
    expect(result[0].name).toBe("root");
    expect(result[1].name).toBe("a");
    expect(result[2].name).toBe("a1");
    expect(result[3].name).toBe("b");
  });
});

describe("getTotalFileCount", () => {
  it("returns 0 for empty folder", () => {
    const folder = makeFolder();
    expect(getTotalFileCount(folder)).toBe(0);
  });

  it("counts files in single folder", () => {
    const folder = makeFolder({
      files: [{} as File, {} as File, {} as File],
    });
    expect(getTotalFileCount(folder)).toBe(3);
  });

  it("counts files recursively across nested folders", () => {
    const root = makeFolder({
      files: [{} as File, {} as File],
      children: [
        makeFolder({
          files: [{} as File],
          children: [makeFolder({ files: [{} as File, {} as File] })],
        }),
        makeFolder({ files: [{} as File] }),
      ],
    });

    // root: 2 + child1: 1 + grandchild: 2 + child2: 1 = 6
    expect(getTotalFileCount(root)).toBe(6);
  });

  it("handles deeply nested structure", () => {
    const level3 = makeFolder({ files: [{} as File] });
    const level2 = makeFolder({ files: [{} as File], children: [level3] });
    const level1 = makeFolder({ files: [{} as File], children: [level2] });
    const root = makeFolder({ files: [{} as File], children: [level1] });

    expect(getTotalFileCount(root)).toBe(4);
  });
});
