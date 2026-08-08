import { describe, it, expect } from "vitest";
import {
  buildGraph,
  extractClusters,
  buildFolderGraph,
  getNodeColor,
} from "../graph-engine";
import { processText } from "../nlp";
import type { NLPResult, ParsedFolder } from "../types";

function makeNLP(overrides: Partial<NLPResult> = {}): NLPResult {
  return {
    tokens: [],
    sentences: [],
    coOccurrences: [],
    wordFrequency: new Map(),
    wordSentences: new Map(),
    ...overrides,
  };
}

describe("buildGraph", () => {
  it("returns empty graph for empty NLP result", () => {
    const graph = buildGraph(makeNLP());
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("creates nodes and edges from co-occurrences", () => {
    const nlp = makeNLP({
      coOccurrences: [
        { wordA: "alpha", wordB: "beta", weight: 3 },
        { wordA: "beta", wordB: "gamma", weight: 2 },
      ],
      wordFrequency: new Map([
        ["alpha", 5],
        ["beta", 4],
        ["gamma", 3],
      ]),
      wordSentences: new Map([
        ["alpha", ["sentence 1"]],
        ["beta", ["sentence 1", "sentence 2"]],
        ["gamma", ["sentence 2"]],
      ]),
    });

    const graph = buildGraph(nlp);
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBe(2);

    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(["alpha", "beta", "gamma"]);
  });

  it("assigns community IDs to all nodes", () => {
    const nlp = makeNLP({
      coOccurrences: [
        { wordA: "a", wordB: "b", weight: 5 },
        { wordA: "c", wordB: "d", weight: 5 },
      ],
      wordFrequency: new Map([
        ["a", 3],
        ["b", 3],
        ["c", 3],
        ["d", 3],
      ]),
      wordSentences: new Map(),
    });

    const graph = buildGraph(nlp);
    for (const node of graph.nodes) {
      expect(node.community).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes betweenness ≥ 0 for all nodes", () => {
    const nlp = makeNLP({
      coOccurrences: [
        { wordA: "x", wordB: "y", weight: 4 },
        { wordA: "y", wordB: "z", weight: 4 },
      ],
      wordFrequency: new Map([
        ["x", 2],
        ["y", 2],
        ["z", 2],
      ]),
      wordSentences: new Map(),
    });

    const graph = buildGraph(nlp);
    for (const node of graph.nodes) {
      expect(node.betweenness).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("extractClusters", () => {
  it("groups nodes by community into clusters", () => {
    const nlp = makeNLP({
      coOccurrences: [
        { wordA: "a", wordB: "b", weight: 5 },
        { wordA: "c", wordB: "d", weight: 5 },
      ],
      wordFrequency: new Map([
        ["a", 3],
        ["b", 3],
        ["c", 3],
        ["d", 3],
      ]),
      wordSentences: new Map(),
    });

    const graph = buildGraph(nlp);
    const clusters = extractClusters(graph);
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    for (const cluster of clusters) {
      expect(cluster.nodes.length).toBeGreaterThan(0);
      expect(cluster.color).toBeTruthy();
      expect(cluster.topKeywords.length).toBeGreaterThan(0);
    }
  });
});

/* ── Folder graph tests ── */

/** Precompute NLP results for every folder with text (matches worker behaviour). */
function buildNlpMap(root: ParsedFolder): Map<string, NLPResult> {
  const map = new Map<string, NLPResult>();
  const walk = (f: ParsedFolder): void => {
    if (f.text.trim()) map.set(f.path, processText(f.text));
    for (const c of f.children) walk(c);
  };
  walk(root);
  return map;
}

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

describe("buildFolderGraph", () => {
  it("creates a folder node from root folder", () => {
    const root = makeFolder({ name: "myFolder", path: "myFolder" });
    const graph = buildFolderGraph(root);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].nodeType).toBe("folder");
    expect(graph.nodes[0].label).toBe("myFolder");
    expect(graph.nodes[0].id).toBe("folder:myFolder");
  });

  it("creates folder hierarchy with edges", () => {
    const root = makeFolder({
      name: "root",
      path: "root",
      children: [
        makeFolder({ name: "child1", path: "root/child1" }),
        makeFolder({ name: "child2", path: "root/child2" }),
      ],
    });

    const graph = buildFolderGraph(root);

    // 3 folder nodes
    const folderNodes = graph.nodes.filter((n) => n.nodeType === "folder");
    expect(folderNodes).toHaveLength(3);

    // 2 edges (root→child1, root→child2)
    expect(graph.edges).toHaveLength(2);
  });

  it("extracts keywords from folder text content", () => {
    const root = makeFolder({
      name: "docs",
      path: "docs",
      text: "JavaScript framework handles rendering. JavaScript framework supports routing. JavaScript framework enables components. React component renders views. React component handles state.",
    });

    const graph = buildFolderGraph(root, buildNlpMap(root));

    // Should have folder node + keyword nodes
    expect(graph.nodes.length).toBeGreaterThan(1);

    const keywordNodes = graph.nodes.filter((n) => n.nodeType === "keyword");
    expect(keywordNodes.length).toBeGreaterThan(0);

    // Keywords should be connected to folder
    const folderEdges = graph.edges.filter(
      (e) => e.source === "folder:docs" || e.target === "folder:docs",
    );
    expect(folderEdges.length).toBeGreaterThan(0);
  });

  it("shares keyword nodes across folders", () => {
    const root = makeFolder({
      name: "root",
      path: "root",
      text: "Blockchain protocol validates transactions. Blockchain protocol ensures security. Blockchain protocol enables decentralization.",
      children: [
        makeFolder({
          name: "child",
          path: "root/child",
          text: "Blockchain protocol supports contracts. Blockchain protocol handles verification.",
        }),
      ],
    });

    const graph = buildFolderGraph(root, buildNlpMap(root));

    // Shared keyword should only appear once (shared between folders)
    const sharedNodes = graph.nodes.filter(
      (n) => n.nodeType === "keyword" && n.label === "blockchain protocol",
    );
    // If multi-word phrase was extracted, it should be shared
    if (sharedNodes.length > 0) {
      expect(sharedNodes.length).toBe(1);
      // Should have accumulated frequency from both folders
      expect(sharedNodes[0].frequency).toBeGreaterThanOrEqual(2);
    } else {
      // Single-word variants should also be shared
      const blockchainNodes = graph.nodes.filter(
        (n) => n.nodeType === "keyword" && n.label === "blockchain",
      );
      expect(blockchainNodes.length).toBeLessThanOrEqual(1);
      if (blockchainNodes.length > 0) {
        expect(blockchainNodes[0].frequency).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("sets fileCount on folder nodes", () => {
    const root = makeFolder({
      name: "project",
      path: "project",
      files: [{} as File, {} as File],
    });

    const graph = buildFolderGraph(root);
    const folderNode = graph.nodes.find((n) => n.nodeType === "folder");

    expect(folderNode?.fileCount).toBe(2);
  });

  it("computes degree for all nodes", () => {
    const root = makeFolder({
      name: "root",
      path: "root",
      text: "Testing degree calculation for nodes.",
      children: [makeFolder({ name: "sub", path: "root/sub" })],
    });

    const graph = buildFolderGraph(root, buildNlpMap(root));

    // Root folder should have degree > 0 (connected to child + keywords)
    const rootNode = graph.nodes.find((n) => n.id === "folder:root");
    expect(rootNode?.degree).toBeGreaterThan(0);
  });
});

describe("getNodeColor", () => {
  it("returns amber for folder nodes", () => {
    const folderNode = {
      id: "folder:test",
      label: "test",
      frequency: 1,
      degree: 0,
      betweenness: 0,
      community: 0,
      sentiment: 0,
      excerpts: [],
      nodeType: "folder" as const,
    };

    expect(getNodeColor(folderNode)).toBe("#f59e0b");
  });

  it("returns cluster color for keyword nodes with valid community", () => {
    const keywordNode = {
      id: "kw:test",
      label: "test",
      frequency: 1,
      degree: 0,
      betweenness: 0,
      community: 0,
      sentiment: 0,
      excerpts: [],
      nodeType: "keyword" as const,
    };

    const color = getNodeColor(keywordNode);
    expect(color).toBeTruthy();
    expect(color).not.toBe("#f59e0b"); // Not amber (folder color)
  });
});
