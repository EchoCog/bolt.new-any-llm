import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME, WORK_DIR } from '~/utils/constants';
import { initializeFileSystem } from './init-fs';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('WebContainer');

interface WebContainerContext {
  loaded: boolean;
  fallbackEnabled: boolean;
  initializing: boolean;
  fileSystemReady: boolean;
  initAttempts: number;
  instance?: WebContainer;
  devMode: boolean;
  error?: string;
  hmrCount?: number;
  preserveFileSystem?: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
  fallbackEnabled: false,
  initializing: false,
  fileSystemReady: false,
  initAttempts: 0,
  devMode: import.meta.env.DEV === true,
  hmrCount: 0,
  preserveFileSystem: false
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;

  // Special handling for dev mode hot module replacement
  import.meta.hot.accept(() => {
    logger.info('Hot module replacement detected for WebContainer module');

    // Increment HMR counter to track reloads
    webcontainerContext.hmrCount = (webcontainerContext.hmrCount || 0) + 1;

    // Explicitly preserve file system state during HMR
    webcontainerContext.preserveFileSystem = true;
    logger.info(`HMR cycle #${webcontainerContext.hmrCount}: File system preservation enabled`);

    // Always set devMode to true during HMR
    if (import.meta.hot?.data.webcontainerContext) {
      import.meta.hot.data.webcontainerContext.devMode = true;
    }
  });
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

// Check for WebContainer API compatibility
const isWebContainerSupported = () => {
  try {
    // Check if WebContainer is defined in window
    return typeof window !== 'undefined' && 'WebContainer' in window;
  } catch (e) {
    logger.warn('Error checking WebContainer support:', e);
    return false;
  }
};

// Use in-memory filesystem fallback when WebContainer isn't supported
const createFallbackFileSystem = async () => {
  logger.info('Creating fallback file system for non-WebContainer environment');
  // Simple in-memory filesystem as fallback
  const inMemoryFs = {
    files: new Map(),
    writeFile: async (path: string, content: string) => {
      logger.debug(`[Fallback FS] Writing to ${path}`);
      inMemoryFs.files.set(path, content);
      return Promise.resolve();
    },
    readFile: async (path: string) => {
      const content = inMemoryFs.files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    },
    rm: async (path: string) => {
      inMemoryFs.files.delete(path);
      return Promise.resolve();
    },
    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      // Just record directory creation in this simple fallback
      logger.debug(`[Fallback FS] Creating directory: ${path}${options?.recursive ? ' (recursive)' : ''}`);
      return Promise.resolve();
    },
    readdir: async (path: string, options?: { withFileTypes?: boolean }) => {
      // Return minimal directory listing info based on paths we know about
      const results: Array<string | { name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
      for (const filePath of inMemoryFs.files.keys()) {
        if (filePath.startsWith(path + '/')) {
          const relativePath = filePath.substring(path.length + 1);
          const firstSegment = relativePath.split('/')[0];

          if (firstSegment && !results.includes(firstSegment)) {
            if (options?.withFileTypes) {
              results.push({
                name: firstSegment,
                isDirectory: () => firstSegment.includes('/'),
                isFile: () => !firstSegment.includes('/')
              });
            } else {
              results.push(firstSegment);
            }
          }
        }
      }
      return results;
    }
  };

  // Create a more robust fallback WebContainer instance
  const fallbackInstance = {
    fs: inMemoryFs,
    mount: async () => Promise.resolve(),
    spawn: async () => {
      return {
        exit: Promise.resolve(0),
        output: new ReadableStream<string>({
          start(controller) {
            controller.enqueue("Command not available in fallback mode");
            controller.close();
          }
        }),
        input: new WritableStream({
          write() {
            // No-op in fallback mode
          }
        }),
        kill: () => Promise.resolve()
      };
    },
    on: (event: string, callback: any) => {
      // No-op implementation for event handler
      logger.debug(`[Fallback] Registered listener for ${event} event`);
      return () => {}; // return dummy unsubscribe function
    },
    internal: {
      watchPaths: (options: any, callback: any) => {
        // Implement more robust watchPaths functionality
        setTimeout(() => {
          // Simulate file system events for the sample files
          const events: any[] = [];
          for (const [path, _] of inMemoryFs.files.entries()) {
            events.push({
              type: 'add_file',
              path,
              buffer: new TextEncoder().encode(inMemoryFs.files.get(path) || '')
            });
          }
          if (events.length > 0) {
            callback([events]);
          }
        }, 500);
        return () => {}; // return dummy unsubscribe function
      }
    },
    teardown: () => Promise.resolve(),
    workdir: WORK_DIR
  } as unknown as WebContainer;

  // Mark we're using fallback mode
  webcontainerContext.fallbackEnabled = true;
  webcontainerContext.loaded = true;
  webcontainerContext.initializing = false;

  // Initialize with sample files
  try {
    await initializeFileSystem(fallbackInstance);
    webcontainerContext.fileSystemReady = true;
    logger.info('Initialized fallback file system with sample files');
  } catch (error) {
    logger.error('Failed to initialize fallback file system:', error);
  }

  return fallbackInstance;
};

// Function to retry WebContainer initialization
const initializeWebContainer = async (attempt = 0): Promise<WebContainer> => {
  try {
    logger.info(`Initializing WebContainer attempt #${attempt + 1} with workdir:`, WORK_DIR_NAME);

    // Check if we're preserving file system from a previous HMR cycle
    const preservingState = webcontainerContext.preserveFileSystem && webcontainerContext.hmrCount && webcontainerContext.hmrCount > 0;
    if (preservingState) {
      logger.info(`HMR cycle #${webcontainerContext.hmrCount}: Attempting to preserve filesystem state`);
    }

    // Add special handling for development mode
    const bootOptions = {
      workdirName: WORK_DIR_NAME,
      // Development mode needs special configuration for WebContainer initialization
      ...(webcontainerContext.devMode ? {
        forceInitialFileHMRFlush: false, // Prevents filesystem reset during HMR
        coepSupportStrategy: 'unspecified' as const,
        additionalPaths: { share: ['/workdir'] }, // Ensure workdir is shared in dev mode
        skipInitFsPrompt: true // Skip initialization prompt in dev mode
      } : {})
    };

    logger.info(`Booting WebContainer with options: ${JSON.stringify(bootOptions)}`);

    // First try with explicit workdir option and dev mode settings if applicable
    const instance = await WebContainer.boot(bootOptions).catch(async (error) => {
      logger.warn('Initial WebContainer boot failed, trying default configuration', error);
      // Try default boot configuration if initial fails
      return WebContainer.boot();
    });

    // Create a simple test file to verify the filesystem is working
    try {
      await instance.fs.writeFile('/test-webcontainer.txt', 'Hello from WebContainer!');
      const testContent = await instance.fs.readFile('/test-webcontainer.txt', 'utf-8');
      if (testContent !== 'Hello from WebContainer!') {
        throw new Error('File content verification failed');
      }
      await instance.fs.rm('/test-webcontainer.txt');
      logger.info('WebContainer file system test successful');
    } catch (fsError) {
      logger.error('Failed to perform file system test:', fsError);
      throw new Error('File system test failed after WebContainer initialization');
    }

    // Initialize the file system with sample files
    await initializeFileSystem(instance);
    webcontainerContext.fileSystemReady = true;

    // Ensure file system events are properly triggered
    setTimeout(() => {
      instance.fs.writeFile('/trigger-fs-watch.tmp', 'This file triggers the file system watcher')
        .then(() => instance.fs.rm('/trigger-fs-watch.tmp'))
        .catch(err => logger.error('Error triggering file watcher:', err));
    }, 1000);

    // Additional file watcher trigger for development mode
    if (webcontainerContext.devMode) {
      // In dev mode, create multiple triggers to ensure the file watcher is properly activated
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const path = `/dev-mode-trigger-${i}.tmp`;
          logger.info(`Creating development mode file trigger ${i}`);
          instance.fs.writeFile(path, `Development mode file system watcher trigger ${i}`)
            .then(() => instance.fs.writeFile(path, `Update content to trigger change event ${i}`))
            .then(() => instance.fs.rm(path))
            .catch(err => logger.error(`Error triggering dev mode file watcher ${i}:`, err));
        }, 1500 + i * 500);
      }
    }

    webcontainerContext.loaded = true;
    webcontainerContext.initializing = false;
    webcontainerContext.error = undefined;
    webcontainerContext.fallbackEnabled = false;
    webcontainerContext.instance = instance;

    return instance;
  } catch (err) {
    logger.error(`WebContainer initialization attempt #${attempt + 1} failed:`, err);

    if (attempt < 2) {
      // Wait and retry
      logger.info(`Retrying WebContainer initialization in 1 second...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return initializeWebContainer(attempt + 1);
    }

    logger.error('All WebContainer initialization attempts failed, falling back to simple mode');
    webcontainerContext.error = err instanceof Error ? err.message : String(err);
    throw err; // Let the caller handle the fallback
  }
};

if (!import.meta.env.SSR) {
  // Skip initialization if we already have a webcontainer instance from HMR
  const shouldInitialize = !(import.meta.hot?.data.webcontainer instanceof Promise);

  // Only set initializing state if we're actually initializing
  if (shouldInitialize) {
    webcontainerContext.initializing = true;
  }

  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(async () => {
        try {
          // Add dev mode detection
          const isDev = import.meta.env.DEV === true;
          if (isDev) {
            logger.info('Running in development mode, applying special WebContainer initialization');
          }

          // Check if WebContainer is supported in this environment
          if (!isWebContainerSupported()) {
            logger.warn('WebContainer API not supported in this environment. Using fallback mode.');
            webcontainerContext.error = 'WebContainer not supported in this environment. Using limited fallback mode.';
            return createFallbackFileSystem();
          }

          // Try to initialize with retry capability
          return await initializeWebContainer();
        } catch (err) {
          // Use fallback implementation when WebContainer fails
          return createFallbackFileSystem();
        }
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
