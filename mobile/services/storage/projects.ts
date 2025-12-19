import { Paths, Directory, File } from 'expo-file-system';
import { Project, ProjectFile, Version } from '../../types';

// Get base directories
const getProjectsDir = () => new Directory(Paths.document, 'lora-projects');
const getVersionsDir = () => new Directory(Paths.document, 'lora-versions');

// Initialize directories
export async function initializeStorage(): Promise<void> {
  try {
    const projectsDir = getProjectsDir();
    if (!projectsDir.exists) {
      await projectsDir.create();
    }

    const versionsDir = getVersionsDir();
    if (!versionsDir.exists) {
      await versionsDir.create();
    }
  } catch (err) {
    console.error('[Storage] Failed to initialize:', err);
  }
}

// Project operations
export async function saveProjectToFileSystem(project: Project): Promise<void> {
  const projectDir = new Directory(getProjectsDir(), project.id);

  try {
    // Create project directory
    if (!projectDir.exists) {
      await projectDir.create();
    }

    // Save each file
    for (const file of project.files) {
      const projectFile = new File(projectDir, file.path);
      await projectFile.write(file.content);
    }

    // Save manifest
    const manifest = {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      files: project.files.map((f) => ({
        path: f.path,
        type: f.type,
      })),
    };

    const manifestFile = new File(projectDir, 'manifest.json');
    await manifestFile.write(JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error('[Storage] Failed to save project:', err);
    throw err;
  }
}

export async function loadProjectFromFileSystem(projectId: string): Promise<Project | null> {
  const projectDir = new Directory(getProjectsDir(), projectId);

  try {
    const manifestFile = new File(projectDir, 'manifest.json');

    if (!manifestFile.exists) {
      return null;
    }

    const manifestContent = await manifestFile.text();
    const manifest = JSON.parse(manifestContent);

    const files: ProjectFile[] = [];
    for (const fileMeta of manifest.files) {
      const file = new File(projectDir, fileMeta.path);

      if (file.exists) {
        const content = await file.text();
        files.push({
          path: fileMeta.path,
          content,
          type: fileMeta.type,
        });
      }
    }

    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      createdAt: new Date(manifest.createdAt),
      updatedAt: new Date(manifest.updatedAt),
      files,
    };
  } catch (err) {
    console.error('[Storage] Failed to load project:', err);
    return null;
  }
}

export async function deleteProjectFromFileSystem(projectId: string): Promise<void> {
  const projectDir = new Directory(getProjectsDir(), projectId);

  try {
    if (projectDir.exists) {
      await projectDir.delete();
    }
  } catch (err) {
    console.error('[Storage] Failed to delete project:', err);
    throw err;
  }
}

// Version control
export async function createVersion(
  project: Project,
  message: string
): Promise<Version> {
  const version: Version = {
    id: generateId(),
    projectId: project.id,
    message,
    timestamp: new Date(),
    files: Object.fromEntries(project.files.map((f) => [f.path, f.content])),
  };

  const versionDir = new Directory(getVersionsDir(), project.id);
  const versionFile = new File(versionDir, `${version.id}.json`);

  try {
    if (!versionDir.exists) {
      await versionDir.create();
    }
    await versionFile.write(JSON.stringify(version));
  } catch (err) {
    console.error('[Storage] Failed to create version:', err);
    throw err;
  }

  return version;
}

export async function listVersions(projectId: string): Promise<Version[]> {
  const versionDir = new Directory(getVersionsDir(), projectId);

  try {
    if (!versionDir.exists) return [];

    const versions: Version[] = [];

    // List files in directory
    for await (const item of versionDir.list()) {
      if (item instanceof File && item.name.endsWith('.json')) {
        const content = await item.text();
        const version = JSON.parse(content);
        version.timestamp = new Date(version.timestamp);
        versions.push(version);
      }
    }

    return versions.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  } catch (err) {
    console.error('[Storage] Failed to list versions:', err);
    return [];
  }
}

export async function loadVersion(
  projectId: string,
  versionId: string
): Promise<Version | null> {
  const versionFile = new File(getVersionsDir(), projectId, `${versionId}.json`);

  try {
    if (!versionFile.exists) return null;

    const content = await versionFile.text();
    const version = JSON.parse(content);
    version.timestamp = new Date(version.timestamp);
    return version;
  } catch (err) {
    console.error('[Storage] Failed to load version:', err);
    return null;
  }
}

// Export project as JSON
export async function exportProject(project: Project): Promise<string> {
  return JSON.stringify(
    {
      ...project,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    },
    null,
    2
  );
}

// Helper functions
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function createNewProject(name: string, description?: string): Project {
  const now = new Date();
  return {
    id: generateId(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    files: [
      {
        path: 'App.tsx',
        content: `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>${name}</Text>
      <Text style={styles.subtitle}>Built with Lora</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
`,
        type: 'tsx',
      },
    ],
  };
}
