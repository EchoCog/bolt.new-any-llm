import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME, WORK_DIR } from '~/utils/constants';
import { initializeFileSystem } from './init-fs';

interface WebContainerContext {
  loaded: boolean;
  error?: string;
  fallbackEnabled?: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
  fallbackEnabled: false
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
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
    console.warn('Error checking WebContainer support:', e);
    return false;
  }
};

// Use in-memory filesystem fallback when WebContainer isn't supported
const createFallbackFileSystem = async () => {
  console.log('Creating fallback file system for non-WebContainer environment');
  // Simple in-memory filesystem as fallback
  const inMemoryFs = {
    files: new Map(),
    writeFile: async (path: string, content: string) => {
      console.log(`[Fallback FS] Writing to ${path}`);
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
    mkdir: async (path: string) => {
      // Just record directory creation in this simple fallback
      console.log(`[Fallback FS] Creating directory: ${path}`);
      return Promise.resolve();
    }
  };

  // Create a minimal fallback WebContainer instance
  const fallbackInstance = {
    fs: inMemoryFs,
    mount: async () => Promise.resolve(),
    spawn: async () => {
      return {
        exit: Promise.resolve(0),
        output: Promise.resolve("Command not available in fallback mode"),
        kill: () => Promise.resolve()
      };
    }
  } as unknown as WebContainer;

  // Mark we're using fallback mode
  webcontainerContext.fallbackEnabled = true;
  webcontainerContext.loaded = true;

  // Initialize with sample files
  await initializeFileSystem(fallbackInstance);

  return fallbackInstance;
};

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(async () => {
        try {
          // Check if WebContainer is supported in this environment
          if (!isWebContainerSupported()) {
            console.warn('WebContainer API not supported in this environment. Using fallback mode.');
            webcontainerContext.error = 'WebContainer not supported in this environment. Using limited fallback mode.';
            return createFallbackFileSystem();
          }

          console.log('Initializing WebContainer with workdir:', WORK_DIR_NAME);

          // Try to boot WebContainer with safer options
          const instance = await WebContainer.boot({
            workdirName: WORK_DIR_NAME
          }).catch(async (error) => {
            console.error('Initial WebContainer boot failed, trying alternative configuration', error);
            // Try alternative boot configuration if initial fails
            return WebContainer.boot();
          });

          // Create a simple test file to verify the filesystem is working
          await instance.fs.writeFile('/hello.txt', 'Hello from WebContainer!');
          console.log('WebContainer initialized successfully!');

          // Initialize the file system with sample files
          await initializeFileSystem(instance);

          webcontainerContext.loaded = true;
          webcontainerContext.error = undefined;
          return instance;
        } catch (err) {
          console.error('Failed to initialize WebContainer, falling back to simple mode:', err);
          webcontainerContext.error = err instanceof Error ? err.message : String(err);

          // Use fallback implementation when WebContainer fails
          return createFallbackFileSystem();
        }
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
