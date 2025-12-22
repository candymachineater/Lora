import { ProjectTemplate, TemplateFile, TemplateMetadata, ProjectType } from './types';

export abstract class BaseTemplate implements ProjectTemplate {
  abstract type: ProjectType;
  abstract name: string;
  abstract description: string;

  generateMetadata(projectName: string): TemplateMetadata {
    return {
      name: projectName,
      projectType: this.type,
      createdAt: new Date().toISOString()
    };
  }

  getInstallCommand(): string[] {
    return ['npm', 'install'];
  }

  abstract generateFiles(projectId: string, projectName: string): TemplateFile[];
  abstract generateClaudeMd(projectPath: string): string;
  abstract getDevCommand(port: number): string[];
}
