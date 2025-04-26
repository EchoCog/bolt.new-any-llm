# Application Architecture

This page provides an overview of the bolt.new-any-llm application architecture, including data flow, component interactions, and key subsystems.

## High-Level Architecture

```mermaid
graph TD
    User[User] --> UI[UI Components]
    UI --> StateManagement[State Management]
    StateManagement --> WebContainer[Web Container]
    StateManagement --> AIServices[AI Services]
    WebContainer --> FileSystem[Virtual File System]
    WebContainer --> TerminalProcess[Terminal Processes]
    AIServices --> ModelProviders[Model Providers]
    
    subgraph "Browser Environment"
        UI
        StateManagement
        WebContainer
        FileSystem
        TerminalProcess
        AIServices
    end
    
    subgraph "External Services"
        ModelProviders
    end
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant StateStores as State Stores
    participant WebContainer
    participant AIService as AI Services
    
    User->>UI: Interact with UI
    UI->>StateStores: Update application state
    
    alt File Operations
        StateStores->>WebContainer: Execute file operation
        WebContainer-->>StateStores: Return operation result
        StateStores-->>UI: Update UI with result
    end
    
    alt Chat with AI
        UI->>StateStores: Send user message
        StateStores->>AIService: Forward message to AI
        AIService-->>StateStores: Return AI response
        StateStores-->>UI: Update chat UI with response
    end
    
    alt Run Command
        UI->>StateStores: Execute terminal command
        StateStores->>WebContainer: Run command in container
        WebContainer-->>StateStores: Stream command output
        StateStores-->>UI: Update terminal UI
    end
```

## Key Subsystems

### Web Container Subsystem

The Web Container provides a browser-based development environment with virtual file system and terminal capabilities.

```mermaid
graph TD
    WebContainer[Web Container] --> FileSystem[Virtual File System]
    WebContainer --> Processes[Process Management]
    WebContainer --> Terminal[Terminal Emulation]
    
    FileSystem --> FSOperations[File Operations]
    FSOperations --> ReadWrite[Read/Write Files]
    FSOperations --> Navigate[Directory Navigation]
    
    Processes --> ProcessExec[Process Execution]
    Processes --> ProcessIO[Process I/O]
    
    Terminal --> TerminalOutput[Output Rendering]
    Terminal --> TerminalInput[Input Handling]
    Terminal --> ANSIHandling[ANSI Code Processing]
```

### Chat and AI Integration

```mermaid
graph TD
    ChatSystem[Chat System] --> MessageManagement[Message Management]
    ChatSystem --> AIProviders[AI Provider Integration]
    ChatSystem --> UIRendering[UI Rendering]
    
    MessageManagement --> History[Chat History]
    MessageManagement --> Storage[Message Storage]
    
    AIProviders --> ModelAPI[Model API Integration]
    AIProviders --> APIKeyManagement[API Key Management]
    
    UIRendering --> Markdown[Markdown Rendering]
    UIRendering --> CodeBlocks[Code Block Highlighting]
    UIRendering --> Artifacts[Artifact Display]
```

## State Management

The application uses several state stores to manage various aspects of the application:

```mermaid
graph TD
    StateManagement[State Management] --> EditorStore[Editor Store]
    StateManagement --> FilesStore[Files Store]
    StateManagement --> TerminalStore[Terminal Store]
    StateManagement --> ChatStore[Chat Store]
    
    EditorStore --> EditorState[Editor State]
    EditorStore --> EditorConfig[Editor Configuration]
    
    FilesStore --> FileTree[File Tree Structure]
    FilesStore --> FileContent[File Content Cache]
    FilesStore --> FileMeta[File Metadata]
    
    TerminalStore --> Sessions[Terminal Sessions]
    TerminalStore --> History[Command History]
    TerminalStore --> Output[Terminal Output]
    
    ChatStore --> Conversations[Conversations]
    ChatStore --> Messages[Message History]
    ChatStore --> ModelConfig[Model Configuration]
```

## Application Bootstrap Flow

```mermaid
sequenceDiagram
    participant App
    participant WebContainerInit
    participant FileSystemInit
    participant UIRendering
    
    App->>WebContainerInit: Initialize Web Container
    WebContainerInit->>FileSystemInit: Set up virtual file system
    FileSystemInit-->>WebContainerInit: File system ready
    WebContainerInit-->>App: Container ready
    
    App->>UIRendering: Render initial UI
    UIRendering-->>App: UI ready
    
    Note over App: Application fully loaded
```
