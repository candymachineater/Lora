import { CodeBlock, ProjectFile } from '../types';

// Parse code blocks from Claude's response
export function parseCodeBlocks(text: string): CodeBlock[] {
  // Match code blocks with format: ```language:filename or ```language
  const regex = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
  const blocks: CodeBlock[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const language = match[1] || 'typescript';
    const filename = match[2]?.trim() || inferFilename(language, blocks.length);
    const content = match[3].trim();

    blocks.push({
      language,
      filename,
      path: filename,
      content,
      type: getFileType(filename),
    });
  }

  return blocks;
}

// Convert code blocks to project files
export function codeBlocksToProjectFiles(blocks: CodeBlock[]): ProjectFile[] {
  return blocks.map((block) => ({
    path: block.path || block.filename || 'unknown',
    name: getFileName(block.path || block.filename || 'unknown'),
    isDirectory: false,
    content: block.content,
    type: block.type,
  }));
}

// Get file name from path
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

// Infer filename from language
function inferFilename(language: string, index: number): string {
  const extensions: Record<string, string> = {
    typescript: 'tsx',
    tsx: 'tsx',
    ts: 'ts',
    javascript: 'js',
    jsx: 'jsx',
    js: 'js',
    json: 'json',
    css: 'css',
    markdown: 'md',
    md: 'md',
  };

  const ext = extensions[language.toLowerCase()] || 'tsx';

  if (index === 0) {
    return `App.${ext}`;
  }

  return `Component${index}.${ext}`;
}

// Get file type from filename
function getFileType(filename: string): 'tsx' | 'ts' | 'json' | 'css' | 'md' {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'tsx':
    case 'jsx':
      return 'tsx';
    case 'ts':
    case 'js':
      return 'ts';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'md':
      return 'md';
    default:
      return 'tsx';
  }
}

// Extract text content (non-code) from response
export function extractTextContent(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').trim();
}

// Check if message contains code blocks
export function hasCodeBlocks(text: string): boolean {
  return /```[\s\S]*?```/.test(text);
}
