import type { Message } from 'ai';
import { generateId } from './fileUtils';

export interface ProjectCommands {
  type: string;
  setupCommand: string;
  followupMessage: string;
}

interface FileContent {
  content: string;
  path: string;
}

// Adding ProjectTemplate type for init-fs.ts
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

// Adding PROJECT_TEMPLATES export
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'python',
    name: 'Python',
    description: 'Simple Python project',
    files: {
      'main.py': 'print("Hello, World!")\n',
      'requirements.txt': '# Python dependencies\n',
      'README.md': '# Python Project\n\nThis is a simple Python project.\n'
    }
  },
  {
    id: 'node',
    name: 'Node.js',
    description: 'Simple Node.js project',
    files: {
      'index.js': 'console.log("Hello, World!");\n',
      'package.json': JSON.stringify(
        {
          name: 'node-project',
          version: '1.0.0',
          description: 'A simple Node.js project',
          main: 'index.js',
          scripts: {
            start: 'node index.js'
          }
        },
        null,
        2
      )
    }
  }
];

export async function detectProjectCommands(files: FileContent[]): Promise<ProjectCommands> {
  const hasFile = (name: string) => files.some((f) => f.path.endsWith(name));

  if (hasFile('package.json')) {
    const packageJsonFile = files.find((f) => f.path.endsWith('package.json'));

    if (!packageJsonFile) {
      return { type: '', setupCommand: '', followupMessage: '' };
    }

    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand: `npm install && npm run ${availableCommand}`,
          followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
        };
      }

      return {
        type: 'Node.js',
        setupCommand: 'npm install',
        followupMessage:
          'Would you like me to inspect package.json to determine the available scripts for running this project?',
      };
    } catch (error) {
      console.error('Error parsing package.json:', error);
      return { type: '', setupCommand: '', followupMessage: '' };
    }
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      setupCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
}

export function createCommandsMessage(commands: ProjectCommands): Message | null {
  if (!commands.setupCommand) {
    return null;
  }

  return {
    role: 'assistant',
    content: `
<boltArtifact id="project-setup" title="Project Setup">
<boltAction type="shell">
${commands.setupCommand}
</boltAction>
</boltArtifact>${commands.followupMessage ? `\n\n${commands.followupMessage}` : ''}`,
    id: generateId(),
    createdAt: new Date(),
  };
}
