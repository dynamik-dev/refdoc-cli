import { fromMarkdown } from "mdast-util-from-markdown";
import type { Chunk } from "./types.js";
import type { Content, Heading } from "mdast";

interface ChunkOptions {
  maxTokens: number;
  minTokens: number;
}

interface RawSection {
  headings: string[];
  depth: number;
  body: string;
  startLine: number;
  endLine: number;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkMarkdown(
  content: string,
  filePath: string,
  options: ChunkOptions
): Chunk[] {
  if (!content.trim()) return [];

  // Strip YAML front matter before parsing
  const stripped = content.replace(FRONTMATTER_RE, "");
  if (!stripped.trim()) return [];

  const lines = content.split("\n");
  const strippedLines = stripped.split("\n");
  const lineOffset = lines.length - strippedLines.length;

  const tree = fromMarkdown(stripped);

  // Pass 1: Extract sections at heading boundaries
  const sections = extractSections(tree.children, strippedLines, lineOffset);

  if (sections.length === 0) {
    // No headings found — treat entire content as a single chunk
    const body = stripped.trim();
    if (!body) return [];
    return [
      makeChunk(filePath, fileTitle(filePath), [fileTitle(filePath)], body, lineOffset + 1, lines.length, 0),
    ];
  }

  // Pass 2: Merge small sections
  const merged = mergeSections(sections, options.minTokens);

  // Pass 3: Split oversized sections
  const final = splitSections(merged, options.maxTokens);

  // Filter out sections with empty bodies
  const nonEmpty = final.filter((s) => s.body.trim().length > 0);

  return nonEmpty.map((section, i) =>
    makeChunk(
      filePath,
      section.headings[section.headings.length - 1] || fileTitle(filePath),
      section.headings,
      section.body,
      section.startLine,
      section.endLine,
      i
    )
  );
}

function extractSections(
  children: Content[],
  lines: string[],
  lineOffset: number
): RawSection[] {
  const sections: RawSection[] = [];
  const headingStack: { text: string; depth: number }[] = [];
  let currentStart: number | null = null;
  let currentBody = "";

  function pushCurrentSection(endLine: number) {
    if (currentStart !== null) {
      const body = currentBody.trim();
      sections.push({
        headings: headingStack.map((h) => h.text),
        depth: headingStack.length > 0 ? headingStack[headingStack.length - 1].depth : 0,
        body,
        startLine: currentStart + lineOffset,
        endLine: endLine + lineOffset,
      });
    }
  }

  // Check if there's content before the first heading
  const firstHeading = children.find(
    (n): n is Heading => n.type === "heading" && n.depth <= 3
  );

  if (firstHeading && firstHeading.position) {
    const firstHeadingLine = firstHeading.position.start.line;
    if (firstHeadingLine > 1) {
      const preambleLines = lines.slice(0, firstHeadingLine - 1);
      const preambleBody = preambleLines.join("\n").trim();
      if (preambleBody) {
        sections.push({
          headings: [fileTitle(/* deferred — caller knows filePath */)],
          depth: 0,
          body: preambleBody,
          startLine: 1 + lineOffset,
          endLine: firstHeadingLine - 1 + lineOffset,
        });
      }
    }
  }

  for (const node of children) {
    if (node.type === "heading" && node.depth <= 3 && node.position) {
      const headingLine = node.position.start.line;

      // Flush previous section
      if (currentStart !== null) {
        pushCurrentSection(headingLine - 1);
        currentBody = "";
      }

      const headingText = extractText(node);
      const depth = node.depth;

      // Update heading stack: pop to depth < current, then push
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ text: headingText, depth });

      currentStart = headingLine;
      currentBody = "";
    } else if (node.position) {
      // Accumulate body content (including h4-h6)
      const nodeStart = node.position.start.line - 1;
      const nodeEnd = node.position.end.line;
      const text = lines.slice(nodeStart, nodeEnd).join("\n");
      if (currentBody) currentBody += "\n\n";
      currentBody += text;
    }
  }

  // Flush last section
  if (currentStart !== null) {
    pushCurrentSection(lines.length);
  }

  return sections;
}

function mergeSections(sections: RawSection[], minTokens: number): RawSection[] {
  if (sections.length <= 1) return sections;

  const result: RawSection[] = [sections[0]];

  for (let i = 1; i < sections.length; i++) {
    const current = sections[i];
    const prev = result[result.length - 1];
    const tokens = estimateTokens(current.body);

    // Only merge siblings (same depth) when the current section is small
    if (tokens < minTokens && prev.depth === current.depth) {
      const heading = formatHeadingLine(current);
      const addition = heading ? heading + "\n\n" + current.body : current.body;
      prev.body = prev.body ? prev.body + "\n\n" + addition : addition;
      prev.endLine = current.endLine;
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

function formatHeadingLine(section: RawSection): string {
  if (section.headings.length === 0) return "";
  const last = section.headings[section.headings.length - 1];
  const hashes = "#".repeat(section.depth || 1);
  return `${hashes} ${last}`;
}

function splitSections(sections: RawSection[], maxTokens: number): RawSection[] {
  const result: RawSection[] = [];

  for (const section of sections) {
    const tokens = estimateTokens(section.body);
    if (tokens <= maxTokens) {
      result.push(section);
      continue;
    }

    // Split at paragraph boundaries
    const paragraphs = section.body.split(/\n\n+/);
    let accumBody = "";
    let subStart = section.startLine;
    const totalLines = section.endLine - section.startLine + 1;
    let linesConsumed = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const candidate = accumBody ? accumBody + "\n\n" + para : para;

      if (estimateTokens(candidate) > maxTokens && accumBody) {
        // Flush accumulated
        const bodyLines = accumBody.split("\n").length;
        result.push({
          ...section,
          body: accumBody,
          startLine: subStart,
          endLine: subStart + bodyLines - 1,
        });
        linesConsumed += bodyLines + 1; // +1 for paragraph gap
        subStart = section.startLine + linesConsumed;
        accumBody = para;
      } else {
        accumBody = candidate;
      }
    }

    // Flush remainder
    if (accumBody.trim()) {
      result.push({
        ...section,
        body: accumBody,
        startLine: subStart,
        endLine: section.endLine,
      });
    }
  }

  return result;
}

function extractText(node: Content): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) {
    return (node.children as Content[]).map(extractText).join("");
  }
  return "";
}

function fileTitle(filePath?: string): string {
  if (!filePath) return "Untitled";
  const name = filePath.split("/").pop() || filePath;
  return name.replace(/\.(md|txt)$/i, "");
}

function makeChunk(
  file: string,
  title: string,
  headings: string[],
  body: string,
  startLine: number,
  endLine: number,
  index: number
): Chunk {
  return {
    id: `${file}:${index}`,
    file,
    title,
    headings: headings.join(" > "),
    body,
    startLine,
    endLine,
    tokenEstimate: estimateTokens(body),
  };
}
