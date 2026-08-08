import { defineConfig } from "vite";
import { rename, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

/** Rename .mjs → .js in dist/ and update references (fixes MIME issues on static hosts). */
function renameMjsPlugin() {
  return {
    name: "rename-mjs-to-js",
    closeBundle: async () => {
      const assetsDir = join("dist", "assets");
      const files = await readdir(assetsDir);
      const renames = new Map<string, string>();

      for (const file of files) {
        if (file.endsWith(".mjs")) {
          const newName = file.replace(/\.mjs$/, ".js");
          await rename(join(assetsDir, file), join(assetsDir, newName));
          renames.set(file, newName);
        }
      }

      if (renames.size === 0) return;

      // Update references in all JS/HTML files
      const allFiles = [
        ...files.map((f) => join(assetsDir, f)),
        join("dist", "index.html"),
      ];
      for (const filePath of allFiles) {
        const resolved = filePath.endsWith(".mjs")
          ? filePath.replace(/\.mjs$/, ".js")
          : filePath;
        if (!resolved.endsWith(".js") && !resolved.endsWith(".html")) continue;
        try {
          let content = await readFile(resolved, "utf-8");
          let changed = false;
          for (const [oldName, newName] of renames) {
            if (content.includes(oldName)) {
              content = content.replaceAll(oldName, newName);
              changed = true;
            }
          }
          if (changed) await writeFile(resolved, content);
        } catch {}
      }
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [renameMjsPlugin()],
  build: {
    outDir: "dist",
    target: "esnext",
    chunkSizeWarningLimit: 1400, // Three.js/3D is ~1.3MB
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Core visualization
          if (id.includes("node_modules/d3")) return "vendor-d3";
          // 3D rendering (Three.js + 3d-force-graph)
          if (
            id.includes("node_modules/three") ||
            id.includes("node_modules/3d-force-graph") ||
            id.includes("node_modules/three-forcegraph")
          )
            return "vendor-3d";
          // NLP
          if (
            id.includes("node_modules/wink-nlp") ||
            id.includes("node_modules/wink-eng-lite-web-model")
          )
            return "vendor-nlp";
          // OCR (dynamically imported)
          if (id.includes("node_modules/tesseract")) return "vendor-ocr";
          // Spreadsheet parsing (dynamically imported)
          if (id.includes("node_modules/xlsx")) return "vendor-xlsx";
          // PDF parsing (dynamically imported)
          if (id.includes("node_modules/pdfjs-dist")) return "vendor-pdf";
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
