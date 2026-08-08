import { el, clear } from "../utils/dom";

type HelpEntry = { title: string; body: string };

const SECTIONS: { heading: string; entries: HelpEntry[] }[] = [
  {
    heading: "Getting Started",
    entries: [
      {
        title: "What is Clustr?",
        body: "Clustr turns any text into a visual knowledge graph — a map of ideas and how they connect. Paste an article, essay, notes, or any text and Clustr will find the key concepts, group related ideas into topics, and show you patterns you might have missed.",
      },
      {
        title: "Quick start",
        body: "1. Click the <strong>Input</strong> tab at the bottom.\n2. Paste or type your text in the editor.\n3. Press <strong>Analyze</strong>.\n4. The graph appears in the center — that's it!",
      },
    ],
  },
  {
    heading: "Input Tab",
    entries: [
      {
        title: "Adding text",
        body: "Type or paste text into the editor. You can also drag-and-drop files (PDF, Word, Excel, images, Markdown, CSV) directly onto the graph area.",
      },
      {
        title: "Import sources",
        body: "Use the source buttons to import from: <strong>File</strong> (various formats), <strong>Folder</strong> (creates hierarchical graph), <strong>Image</strong> (OCR text extraction), <strong>URL</strong> (web page), <strong>YouTube</strong> (video transcript), <strong>RSS</strong> (feed items), <strong>Evernote</strong> (.enex), <strong>JSON</strong> (extracts text fields), <strong>Twitter/X</strong> (archive).",
      },
      {
        title: "Folder upload",
        body: "Upload an entire folder to create a hierarchical graph. Folders become amber-colored parent nodes, connected to keywords extracted from files inside each folder.",
      },
      {
        title: "Analyze vs Append",
        body: "<strong>Analyze</strong> replaces any previous text and rebuilds the graph from scratch. <strong>+ Append</strong> adds new text on top of what you already have — useful for comparing multiple sources. Each append creates a snapshot so you can track trends.",
      },
    ],
  },
  {
    heading: "The Graph",
    entries: [
      {
        title: "What do the circles mean?",
        body: "Each circle (node) is a key concept extracted from your text. <strong>Bigger circles</strong> = more connections. <strong>Colors</strong> represent topics — nodes of the same color belong to the same theme. Amber/orange nodes represent folders when using folder upload.",
      },
      {
        title: "What do the lines mean?",
        body: "Lines (edges) connect concepts that appear near each other in the text. <strong>Thicker lines</strong> = stronger association between two ideas.",
      },
      {
        title: "Navigation",
        body: "<strong>Scroll</strong> to zoom in/out. <strong>Click and drag</strong> the background to pan. <strong>Drag a node</strong> to reposition it. You can also use the control buttons in the top-right corner of the graph.",
      },
      {
        title: "Selecting nodes",
        body: "<strong>Click</strong> a node to select it — a detail panel will appear showing its connections and excerpts. Click multiple nodes to see excerpts containing all selected terms. Press <strong>Escape</strong> to deselect all.",
      },
      {
        title: "Deselecting nodes",
        body: "<strong>Right-click</strong> a selected node to deselect just that node while keeping others selected.",
      },
      {
        title: "Excluding nodes",
        body: "<strong>Ctrl+click</strong> (or <strong>Cmd+click</strong> on Mac) a node to exclude it from the graph (for example, a word that isn't useful). You can restore excluded nodes from the Analysis tab.",
      },
      {
        title: "Sentiment colors",
        body: "Click the <strong>smiley face button</strong> (☺) in the graph controls to toggle sentiment coloring. Green = positive, red = negative, grey = neutral.",
      },
    ],
  },
  {
    heading: "Analysis Tab",
    entries: [
      {
        title: "Top Keywords",
        body: "The most connected concepts in your text, ranked by importance. Click any keyword to highlight it in the graph. Click the × to exclude it.",
      },
      {
        title: "Topics",
        body: "Groups of related ideas that Clustr detected automatically. Click a topic to highlight all its nodes in the graph.",
      },
      {
        title: "Content Gaps",
        body: "Pairs of topics that are weakly connected — potential areas where your text could bridge ideas together.",
      },
      {
        title: "AI Analysis",
        body: "Click one of the AI action buttons (Summary, Research Qs, Insights, Ideas) to get AI-generated analysis of your graph. Requires an API key configured in Settings.",
      },
      {
        title: "Sentiment & Statistics",
        body: "A breakdown of positive/negative/neutral tone in your text, plus graph metrics like density, modularity, and diversity score.",
      },
      {
        title: "Trends",
        body: "After appending new text, this section shows which keywords are <strong>new</strong> and which are <strong>growing</strong> compared to the previous snapshot.",
      },
    ],
  },
  {
    heading: "Ask Questions Tab",
    entries: [
      {
        title: "How it works",
        body: 'A conversational AI that knows about your graph. Ask questions like "What are the main themes?" or "How do topics 0 and 2 relate?" The AI sees your keywords, topics, gaps, and statistics.',
      },
      {
        title: "Node focus",
        body: "Select nodes in the graph before chatting — the AI will receive extra context about those specific concepts and their connections.",
      },
      {
        title: "Model selector",
        body: "Choose the AI model in <strong>Settings &rarr; AI Model</strong> (or use Ctrl+4). The model list is fetched live from OpenRouter and applies to both chat and topic extraction. You need an OpenRouter API key.",
      },
    ],
  },
  {
    heading: "Settings Tab",
    entries: [
      {
        title: "API Keys",
        body: "Enter your <strong>OpenRouter</strong> API key to enable AI features (chat, summaries, topic maps). All AI requests route through OpenRouter, which provides up-to-date access to Google Gemini, Anthropic Claude, and OpenAI models. The key is stored locally in your browser and sent only to OpenRouter. Create a key at <a href=\"https://openrouter.ai\" target=\"_blank\" rel=\"noopener\">openrouter.ai</a>.",
      },
      {
        title: "Proxy",
        body: "When importing from external URLs, Clustr uses a proxy to bypass browser restrictions. You can change the proxy URL here if the default isn't working.",
      },
      {
        title: "OCR Language",
        body: "Select the language for text extraction from images and scanned PDFs. Supports 15 languages including English, French, German, Spanish, Japanese, Chinese, and more. Changing the language downloads the appropriate model (~2-15MB) on first use.",
      },
      {
        title: "Export",
        body: "Download your graph in various formats: JSON (raw data), SVG/PNG (images), CSV (keywords or analytics), or GEXF (for Gephi).",
      },
      {
        title: "Wipe All Data",
        body: "Permanently deletes everything — API keys, chat history, cached analyses, and saved text. Use with caution.",
      },
    ],
  },
  {
    heading: "Tips & Shortcuts",
    entries: [
      {
        title: "Ctrl+Enter — Analyze",
        body: "Press <strong>Ctrl+Enter</strong> (or <strong>Cmd+Enter</strong> on Mac) from anywhere to run the analysis on the current text.",
      },
      {
        title: "Ctrl+1–5 — Switch panels",
        body: "Press <strong>Ctrl+1</strong> for Input, <strong>Ctrl+2</strong> for Analysis, <strong>Ctrl+3</strong> for Ask Questions, <strong>Ctrl+4</strong> for Settings, <strong>Ctrl+5</strong> for Help.",
      },
      {
        title: "Ctrl+click — Exclude node",
        body: "<strong>Ctrl+click</strong> (or <strong>Cmd+click</strong>) a node to quickly exclude it from the graph.",
      },
      {
        title: "Right-click — Deselect node",
        body: "<strong>Right-click</strong> a selected node to deselect just that node.",
      },
      {
        title: "Paste anywhere",
        body: "Press <strong>Ctrl+V</strong> anywhere (outside a text field) to load text or an image into the Input tab.",
      },
      {
        title: "Drag and drop",
        body: "Drop any supported file onto the graph area to import it.",
      },
      {
        title: "Escape",
        body: "Press <strong>Escape</strong> to deselect all nodes in the graph.",
      },
      {
        title: "Zoom labels",
        body: "Zoom in past 1.4× to reveal labels on smaller nodes that are normally hidden.",
      },
    ],
  },
];

/** Render the help panel into the target element. */
export function createHelpPanel(target: HTMLElement): void {
  clear(target);

  for (const section of SECTIONS) {
    const sec = el("div", { cls: "panel-section" });
    sec.appendChild(
      el("div", { cls: "panel-section-title", text: section.heading }),
    );

    for (const entry of section.entries) {
      const details = document.createElement("details");
      details.className = "help-entry";
      const summary = document.createElement("summary");
      summary.className = "help-entry-title";
      summary.textContent = entry.title;
      const body = el("div", { cls: "help-entry-body" });
      body.innerHTML = entry.body;
      details.appendChild(summary);
      details.appendChild(body);
      sec.appendChild(details);
    }

    target.appendChild(sec);
  }
}
