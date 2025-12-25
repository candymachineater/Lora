import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project, ProjectFile } from '../types';

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  currentFile: string | null;
  showNewProjectModal: boolean;

  // Computed
  currentProject: () => Project | null;
  currentFileContent: () => ProjectFile | null;

  // Actions
  addProject: (project: Project) => void;
  setShowNewProjectModal: (show: boolean) => void;
  setProjects: (projects: Project[]) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  renameProject: (oldId: string, newProject: Project) => void;
  setCurrentProject: (id: string | null) => void;
  setCurrentFile: (path: string | null) => void;

  // File operations
  addFile: (projectId: string, file: ProjectFile) => void;
  updateFile: (projectId: string, path: string, content: string) => void;
  deleteFile: (projectId: string, path: string) => void;
  applyCodeBlocks: (projectId: string, files: ProjectFile[]) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProjectId: null,
      currentFile: null,
      showNewProjectModal: false,

      setShowNewProjectModal: (show: boolean) => set({ showNewProjectModal: show }),

      currentProject: () => {
        const { projects, currentProjectId } = get();
        return projects.find((p) => p.id === currentProjectId) || null;
      },

      currentFileContent: () => {
        const project = get().currentProject();
        const currentFile = get().currentFile;
        if (!project || !currentFile) return null;
        return project.files.find((f) => f.path === currentFile) || null;
      },

      addProject: (project: Project) =>
        set((state) => ({
          projects: [...state.projects, project],
          currentProjectId: project.id,
        })),

      setProjects: (projects: Project[]) =>
        set({ projects }),

      updateProject: (id: string, updates: Partial<Project>) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
          ),
        })),

      deleteProject: (id: string) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          currentProjectId:
            state.currentProjectId === id ? null : state.currentProjectId,
        })),

      renameProject: (oldId: string, newProject: Project) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === oldId ? newProject : p
          ),
          currentProjectId:
            state.currentProjectId === oldId ? newProject.id : state.currentProjectId,
        })),

      setCurrentProject: (id: string | null) =>
        set({ currentProjectId: id, currentFile: null }),

      setCurrentFile: (path: string | null) =>
        set({ currentFile: path }),

      addFile: (projectId: string, file: ProjectFile) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  files: [...p.files, file],
                  updatedAt: new Date(),
                }
              : p
          ),
        })),

      updateFile: (projectId: string, path: string, content: string) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  files: p.files.map((f) =>
                    f.path === path ? { ...f, content } : f
                  ),
                  updatedAt: new Date(),
                }
              : p
          ),
        })),

      deleteFile: (projectId: string, path: string) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  files: p.files.filter((f) => f.path !== path),
                  updatedAt: new Date(),
                }
              : p
          ),
          currentFile: state.currentFile === path ? null : state.currentFile,
        })),

      applyCodeBlocks: (projectId: string, files: ProjectFile[]) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;

            const updatedFiles = [...p.files];
            for (const newFile of files) {
              const existingIndex = updatedFiles.findIndex(
                (f) => f.path === newFile.path
              );
              if (existingIndex >= 0) {
                updatedFiles[existingIndex] = newFile;
              } else {
                updatedFiles.push(newFile);
              }
            }

            return {
              ...p,
              files: updatedFiles,
              updatedAt: new Date(),
            };
          }),
        })),
    }),
    {
      name: 'lora-projects',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
