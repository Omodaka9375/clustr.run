import { processText } from "../core/nlp";
import { buildFolderGraph } from "../core/graph-engine";
import type { NLPResult, ParsedFolder, GraphData } from "../core/types";

export type NLPWorkerRequest =
  | ({ _rid: number; type: "text"; text: string })
  | ({ _rid: number; type: "folder"; folder: ParsedFolder });

export type NLPWorkerResponse =
  | (NLPResult & { _rid: number; type: "text" })
  | ({ _rid: number; type: "folder"; graph: GraphData })
  | { _rid: number; type: "error"; message: string };

/** Build a folder graph, computing NLP per folder here (off the main thread). */
function buildFolderGraphWithNlp(root: ParsedFolder): GraphData {
  const nlpByPath = new Map<string, NLPResult>();
  const collect = (f: ParsedFolder): void => {
    if (f.text.trim()) nlpByPath.set(f.path, processText(f.text));
    for (const c of f.children) collect(c);
  };
  collect(root);
  return buildFolderGraph(root, nlpByPath);
}

self.onmessage = (e: MessageEvent<NLPWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "folder") {
      const graph = buildFolderGraphWithNlp(req.folder);
      self.postMessage({ _rid: req._rid, type: "folder", graph });
      return;
    }
    // Maps are structured-cloneable and survive postMessage as-is.
    const result = processText(req.text);
    self.postMessage({ ...result, _rid: req._rid, type: "text" });
  } catch (err) {
    // Surface worker-side failures to the client.
    self.postMessage({
      _rid: req._rid,
      type: "error",
      message: (err as Error).message,
    });
  }
};
