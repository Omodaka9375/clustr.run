import type { AppState, GraphNode, SourceMeta } from "../core/types";
import type { GraphViewMode, GraphContentMode } from "../config";

/** All events the app can emit. */
export type EventMap = {
  "text:submitted": { text: string };
  "text:appended": { text: string };
  "text:cleared": void;
  "graph:updated": { state: AppState };
  "graph:nodeSelected": { node: GraphNode };
  "graph:nodeDeselected": { nodeId: string };
  "graph:selectionCleared": void;
  "graph:highlightNode": { nodeId: string };
  "graph:highlightCluster": { clusterId: number };
  "graph:excludeNode": { nodeId: string };
  "graph:restoreNode": { nodeId: string };
  "graph:viewModeChanged": { mode: GraphViewMode };
  "graph:contentModeChanged": { mode: GraphContentMode };
  "graph:peelLayer": void;
  "graph:unpeelLayer": void;
  "graph:resetPeelLayers": void;
  "compare:submitted": { textB: string };
  "analysis:ready": { state: AppState };
  "ai:responseStart": void;
  "ai:responseEnd": { content: string };
  "ai:error": { message: string };
  "panel:switch": { panel: AppState["activePanel"] };
  "panel:closed": void;
  "settings:changed": void;
  "settings:modelChanged": { modelId: string };
  "export:trigger": { format: string };
  "source:imported": { text: string; meta: SourceMeta };
  "folder:uploaded": { folder: import("../core/types").ParsedFolder };
  "nav:panel": { panel: string };
};

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  /** Subscribe to an event. */
  on<K extends keyof EventMap>(
    event: K,
    handler: Handler<EventMap[K]>,
  ): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    const set = this.handlers.get(event)!;
    set.add(handler as Handler<unknown>);
    return () => set.delete(handler as Handler<unknown>);
  }

  /** Emit an event to all subscribers. */
  emit<K extends keyof EventMap>(
    event: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    const payload = args[0];
    for (const handler of set) handler(payload);
  }
}

/** Singleton event bus. */
export const bus = new EventBus();
