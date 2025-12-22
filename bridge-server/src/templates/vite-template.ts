import { BaseTemplate } from './base-template';
import { TemplateFile, ProjectType } from './types';

export class ViteTemplate extends BaseTemplate {
  type: ProjectType = 'web';
  name = 'React + Vite Web App';
  description = 'Modern React web app with Vite';

  generateFiles(projectId: string, projectName: string): TemplateFile[] {
    const files: TemplateFile[] = [];

    // package.json
    files.push({
      path: 'package.json',
      content: JSON.stringify({
        name: projectId,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
          lint: 'eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0'
        },
        dependencies: {
          'react': '^18.3.1',
          'react-dom': '^18.3.1'
        },
        devDependencies: {
          '@types/react': '^18.3.12',
          '@types/react-dom': '^18.3.1',
          '@vitejs/plugin-react': '^4.3.4',
          '@typescript-eslint/eslint-plugin': '^8.15.0',
          '@typescript-eslint/parser': '^8.15.0',
          'eslint': '^9.15.0',
          'eslint-plugin-react-hooks': '^5.0.0',
          'eslint-plugin-react-refresh': '^0.4.14',
          'typescript': '^5.6.3',
          'vite': '^6.0.3'
        }
      }, null, 2)
    });

    // vite.config.ts
    files.push({
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow mobile access
    strictPort: true,
  },
})
`
    });

    // index.html
    files.push({
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
    });

    // src/main.tsx
    files.push({
      path: 'src/main.tsx',
      content: `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
    });

    // src/App.tsx
    files.push({
      path: 'src/App.tsx',
      content: `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <h1>${projectName}</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="subtitle">
        Start building your web app with React + Vite
      </p>
    </div>
  )
}

export default App
`
    });

    // src/App.css
    files.push({
      path: 'src/App.css',
      content: `.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
  margin-bottom: 1em;
}

.card {
  padding: 2em;
}

.subtitle {
  color: #888;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}

button:hover {
  border-color: #646cff;
}

button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  button {
    background-color: #f9f9f9;
    color: #213547;
  }
}
`
    });

    // src/index.css
    files.push({
      path: 'src/index.css',
      content: `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
`
    });

    // tsconfig.json
    files.push({
      path: 'tsconfig.json',
      content: JSON.stringify({
        files: [],
        references: [
          { path: './tsconfig.app.json' },
          { path: './tsconfig.node.json' }
        ]
      }, null, 2)
    });

    // tsconfig.app.json
    files.push({
      path: 'tsconfig.app.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          isolatedModules: true,
          moduleDetection: 'force',
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedSideEffectImports: true
        },
        include: ['src']
      }, null, 2)
    });

    // tsconfig.node.json
    files.push({
      path: 'tsconfig.node.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2023'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
          strict: true,
          noEmit: true
        },
        include: ['vite.config.ts']
      }, null, 2)
    });

    // eslint.config.js
    files.push({
      path: 'eslint.config.js',
      content: `import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
`
    });

    // .gitignore
    files.push({
      path: '.gitignore',
      content: `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`
    });

    return files;
  }

  generateClaudeMd(projectPath: string): string {
    return `# Web App Development Guide

This is a React + Vite web application project.

## Sandbox Restrictions

- You can ONLY access files within: \`${projectPath}\`
- No access to parent directories or other projects
- All file operations must be within this project folder

## Preview System

Lora automatically runs \`npm run dev\` when you preview.
- HMR (Hot Module Replacement) is fully supported
- Changes appear instantly in the Preview tab
- No manual server management needed

## Project Structure

- \`src/\` - Source code
  - \`main.tsx\` - React entry point
  - \`App.tsx\` - Root component
  - \`App.css\` - Component styles
  - \`index.css\` - Global styles
- \`index.html\` - HTML template
- \`vite.config.ts\` - Vite configuration

## Technology Stack

- React 18
- TypeScript
- Vite (fast build tool)
`;
  }

  getDevCommand(port: number): string[] {
    return ['npm', 'run', 'dev', '--', '--port', port.toString()];
  }
}
