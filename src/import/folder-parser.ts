import type { ParsedFolder } from "../core/types";
import { parseFile } from "./file-parser";

/** Stats collected during folder parsing. */
export type FolderParseStats = {
  totalFiles: number;
  parsed: number;
  skipped: number;
  emptyFolders: number;
};

/**
 * Parse a FileList from a folder upload into a tree structure.
 * Uses webkitRelativePath to reconstruct folder hierarchy.
 */
export async function parseFolderUpload(
  files: FileList,
): Promise<{ root: ParsedFolder; stats: FolderParseStats }> {
  const stats: FolderParseStats = {
    totalFiles: 0,
    parsed: 0,
    skipped: 0,
    emptyFolders: 0,
  };
  // Build a map of path → files
  const pathMap = new Map<string, File[]>();

  for (const file of Array.from(files)) {
    // webkitRelativePath: "rootFolder/subFolder/file.txt"
    const relativePath = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    if (!relativePath) continue;

    // Get folder path (everything except file name)
    const parts = relativePath.split("/");
    const folderPath = parts.slice(0, -1).join("/") || parts[0];

    if (!pathMap.has(folderPath)) {
      pathMap.set(folderPath, []);
    }
    pathMap.get(folderPath)!.push(file);
  }

  // Find root folder name
  const allPaths = Array.from(pathMap.keys());
  if (allPaths.length === 0) {
    throw new Error("No files found in folder");
  }

  const rootName = allPaths[0].split("/")[0];

  stats.totalFiles = Array.from(pathMap.values()).reduce(
    (n, f) => n + f.length,
    0,
  );

  // Build tree recursively
  const root = await buildFolderTree(rootName, rootName, pathMap, stats);
  return { root, stats };
}

/**
 * Recursively build folder tree from path map.
 */
async function buildFolderTree(
  name: string,
  path: string,
  pathMap: Map<string, File[]>,
  stats: FolderParseStats,
): Promise<ParsedFolder> {
  // Get files directly in this folder
  const files = pathMap.get(path) ?? [];

  // Find direct child folders
  const childPaths = new Set<string>();
  for (const p of pathMap.keys()) {
    if (p.startsWith(path + "/")) {
      // Get the immediate child folder name
      const remainder = p.slice(path.length + 1);
      const nextSegment = remainder.split("/")[0];
      if (nextSegment) {
        childPaths.add(path + "/" + nextSegment);
      }
    }
  }

  // Build children recursively
  const children: ParsedFolder[] = [];
  for (const childPath of childPaths) {
    const childName = childPath.split("/").pop() ?? childPath;
    const child = await buildFolderTree(childName, childPath, pathMap, stats);
    children.push(child);
  }

  // Sort children alphabetically
  children.sort((a, b) => a.name.localeCompare(b.name));

  // Extract text from files in this folder
  const text = await extractFolderText(files, stats);
  if (files.length > 0 && !text.trim()) stats.emptyFolders++;

  return {
    name,
    path,
    files,
    children,
    text,
  };
}

/**
 * Extract and concatenate text from all files in a folder.
 */
async function extractFolderText(
  files: File[],
  stats: FolderParseStats,
): Promise<string> {
  const texts: string[] = [];

  for (const file of files) {
    try {
      const text = await parseFile(file);
      if (text.trim()) {
        texts.push(text);
        stats.parsed++;
      } else {
        stats.skipped++;
      }
    } catch {
      stats.skipped++;
    }
  }

  return texts.join("\n\n");
}

/**
 * Flatten folder tree into array of all folders.
 */
export function flattenFolderTree(root: ParsedFolder): ParsedFolder[] {
  const result: ParsedFolder[] = [root];
  for (const child of root.children) {
    result.push(...flattenFolderTree(child));
  }
  return result;
}

/**
 * Get total file count in folder tree.
 */
export function getTotalFileCount(folder: ParsedFolder): number {
  let count = folder.files.length;
  for (const child of folder.children) {
    count += getTotalFileCount(child);
  }
  return count;
}
