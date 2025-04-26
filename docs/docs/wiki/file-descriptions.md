# File Descriptions

This page provides descriptions of key files in the bolt.new-any-llm project, organized by directory.

## Root Directory Files

| File | Description |
|------|-------------|
| `package.json` | Node.js project configuration, dependencies, and scripts |
| `tsconfig.json` | TypeScript compiler configuration |
| `vite.config.ts` | Vite build tool configuration |
| `uno.config.ts` | UnoCSS configuration |
| `docker-compose.yaml` | Docker Compose configuration for containerized deployment |
| `Dockerfile` | Docker container definition |
| `README.md` | Project overview and documentation |
| `CONTRIBUTING.md` | Contribution guidelines |
| `FAQ.md` | Frequently asked questions |
| `LICENSE` | Project license information |

## App Components

### Chat Components (`app/components/chat/`)

| File | Description |
|------|-------------|
| `BaseChat.tsx` | Core chat component with message handling logic |
| `Messages.client.tsx` | Client-side message rendering component |
| `UserMessage.tsx` | Renders user-sent messages |
| `AssistantMessage.tsx` | Renders assistant (AI) responses |
| `CodeBlock.tsx` | Code syntax highlighting and rendering |
| `Markdown.tsx` | Markdown parsing and rendering |
| `APIKeyManager.tsx` | Manages API keys for AI providers |
| `ModelSelector.tsx` | UI for selecting and configuring AI models |
| `SpeechRecognition.tsx` | Voice input capabilities |
| `ChatExportAndImport/` | Components for exporting/importing chat histories |

### Workbench Components (`app/components/workbench/`)

| File | Description |
|------|-------------|
| `FileTree.tsx` | File system navigation tree component |
| `WebContainerStatus.tsx` | Status display for web container with loading and error states |

## Library Files (`app/lib/`)

### Web Container (`app/lib/webcontainer/`)

| File | Description |
|------|-------------|
| `index.ts` | Main web container API and initialization |
| `context.ts` | React context provider for web container |
| `init-fs.ts` | Initializes the virtual file system with files and directories |

### Stores (`app/lib/stores/`)

| File | Description |
|------|-------------|
| `editor.ts` | Editor state management |
| `files.ts` | File system state management |
| `terminal.ts` | Terminal state and session management |

## Routes (`app/routes/`)

| File | Description |
|------|-------------|
| `_index.tsx` | Main application entry point |
| `chat.$id.tsx` | Chat interface with dynamic ID parameter |
| `api.chat.ts` | API endpoint for chat functionality |
| `api.models.ts` | API endpoint for model management |
| `api.enhancer.ts` | API endpoint for enhancement features |
| `git.tsx` | Git integration interface |

## Utility Files (`app/utils/`)

| File | Description |
|------|-------------|
| `buffer.ts` | Buffer manipulation utilities |
| `classNames.ts` | CSS class name management helpers |
| `constants.ts` | Application-wide constants |
| `debounce.ts` | Function debouncing utilities |
| `diff.ts` | Content differencing utilities |
| `fileUtils.ts` | File handling utilities |
| `folderImport.ts` | Utilities for importing folders |
| `logger.ts` | Logging functionality |
| `markdown.ts` | Markdown processing utilities |
| `projectCommands.ts` | Project command execution utilities |
| `shell.ts` | Shell command execution utilities |
| `terminal.ts` | Terminal utilities |

## Type Definitions (`app/types/` and `types/`)

| File | Description |
|------|-------------|
| `actions.ts` | Action type definitions |
| `artifact.ts` | Artifact type definitions |
| `global.d.ts` | Global TypeScript declarations |
| `model.ts` | Model-related type definitions |
| `terminal.ts` | Terminal-related type definitions |
| `theme.ts` | Theme-related type definitions |

## Style Files (`app/styles/`)

| File | Description |
|------|-------------|
| `index.scss` | Main stylesheet entry point |
| `variables.scss` | CSS variables and theming |
| `animations.scss` | Animation definitions |
| `z-index.scss` | Z-index management |

## Functions (`functions/`)

| File | Description |
|------|-------------|
| `[[path]].ts` | Serverless function handler with dynamic path routing |
