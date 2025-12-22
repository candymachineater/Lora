import { ProjectTemplate } from './types';
import { ExpoTemplate } from './expo-template';
import { ViteTemplate } from './vite-template';

const templates = new Map<string, ProjectTemplate>([
  ['mobile', new ExpoTemplate()],
  ['web', new ViteTemplate()],
]);

export function getTemplate(type: string): ProjectTemplate {
  const template = templates.get(type);
  if (!template) {
    throw new Error(`Unknown project type: ${type}`);
  }
  return template;
}

export function getAllTemplates(): ProjectTemplate[] {
  return Array.from(templates.values());
}

export { ExpoTemplate } from './expo-template';
export { ViteTemplate } from './vite-template';
export * from './types';
