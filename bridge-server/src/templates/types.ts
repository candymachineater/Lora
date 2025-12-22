export type ProjectType = 'mobile' | 'web';

export interface TemplateFile {
  path: string;
  content: string;
}

export interface TemplateMetadata {
  name: string;
  projectType: ProjectType;
  createdAt: string;
}

export interface ProjectTemplate {
  type: ProjectType;
  name: string;
  description: string;

  generateFiles(projectId: string, projectName: string): TemplateFile[];
  generateMetadata(projectName: string): TemplateMetadata;
  generateClaudeMd(projectPath: string): string;
  getInstallCommand(): string[];
  getDevCommand(port: number): string[];
}
