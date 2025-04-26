import type { PathWatcherEvent, WebContainer } from '@webcontainer/api';
import { getEncoding } from 'istextorbinary';
import { map, type MapStore } from 'nanostores';
import { Buffer } from 'node:buffer';
import * as nodePath from 'node:path';
import { bufferWatchEvents } from '~/utils/buffer';
import { WORK_DIR } from '~/utils/constants';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import { toast } from 'react-toastify';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf8', { fatal: true });

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export class FilesStore {
  #webcontainer: Promise<WebContainer>;

  /**
   * Tracks the number of files without folders.
   */
  #size = 0;

  /**
   * @note Keeps track all modified files with their original content since the last user message.
   * Needs to be reset when the user sends another message and all changes have to be submitted
   * for the model to be aware of the changes.
   */
  #modifiedFiles: Map<string, string> = import.meta.hot?.data.modifiedFiles ?? new Map();

  /**
   * Map of files that matches the state of WebContainer.
   */
  files: MapStore<FileMap> = import.meta.hot?.data.files ?? map({});

  /**
   * Flag to track if filesystem watcher is initialized
   */
  #isWatcherInitialized = false;

  /**
   * Flag to track if an initial scan is in progress
   */
  #isInitialScanInProgress = false;

  /**
   * Number of initialization attempts
   */
  #initAttempts = 0;
  #maxInitAttempts = 3;

  get filesCount() {
    return this.#size;
  }

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.files = this.files;
      import.meta.hot.data.modifiedFiles = this.#modifiedFiles;
    }

    this.#init();
  }

  getFile(filePath: string) {
    const dirent = this.files.get()[filePath];

    if (dirent?.type !== 'file') {
      return undefined;
    }

    return dirent;
  }

  getFileModifications() {
    return computeFileModifications(this.files.get(), this.#modifiedFiles);
  }

  resetFileModifications() {
    this.#modifiedFiles.clear();
  }

  async saveFile(filePath: string, content: string) {
    const webcontainer = await this.#webcontainer;

    try {
      const relativePath = nodePath.relative(webcontainer.workdir, filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, write '${relativePath}'`);
      }

      const oldContent = this.getFile(filePath)?.content;

      if (!oldContent) {
        logger.warn(`No existing content found for ${filePath}, creating new file`);
      } else if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent);
      }

      // Ensure parent directory exists
      const dirPath = nodePath.dirname(relativePath);
      if (dirPath !== '.') {
        try {
          await webcontainer.fs.mkdir(dirPath, { recursive: true });
        } catch (dirErr: any) {
          // Ignore if directory already exists
          if (!dirErr.toString().includes('EEXIST')) {
            logger.warn(`Failed to create directory ${dirPath}: ${dirErr}`);
          }
        }
      }

      await webcontainer.fs.writeFile(relativePath, content);

      // we immediately update the file and don't rely on the `change` event coming from the watcher
      this.files.setKey(filePath, { type: 'file', content, isBinary: false });

      logger.info('File updated');
    } catch (error) {
      logger.error('Failed to update file content\n\n', error);
      throw error;
    }
  }

  /**
   * Restores files from persisted storage to the WebContainer filesystem
   * @param savedFiles - Files loaded from persistence storage
   */
  async restoreFiles(savedFiles: FileMap) {
    try {
      if (!savedFiles || Object.keys(savedFiles).length === 0) {
        logger.warn('No saved files to restore');
        return 0;
      }

      logger.info('Restoring files from persistence');
      const webcontainer = await this.#webcontainer;
      let restoredCount = 0;
      let errorCount = 0;
      let retryCount = 0;

      // First, create all necessary directories
      const allDirectories = new Set<string>();

      for (const [filePath] of Object.entries(savedFiles)) {
        const relativePath = this.#getRelativePath(filePath, webcontainer.workdir);
        if (!relativePath) continue;

        const dirPath = nodePath.dirname(relativePath);
        if (dirPath !== '.') {
          allDirectories.add(dirPath);

          // Add all parent directories too
          const segments = dirPath.split('/');
          let currentPath = '';
          for (const segment of segments) {
            if (!segment) continue;
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            allDirectories.add(currentPath);
          }
        }
      }

      // Create directories in order of path depth (shortest first)
      const sortedDirs = Array.from(allDirectories).sort((a, b) =>
        a.split('/').length - b.split('/').length
      );

      for (const dir of sortedDirs) {
        try {
          await webcontainer.fs.mkdir(dir, { recursive: false });
          logger.debug(`Created directory: ${dir}`);
        } catch (err: any) {
          // Ignore if directory already exists
          if (!err.toString().includes('EEXIST')) {
            logger.warn(`Failed to create directory ${dir}: ${err}`);
          }
        }
      }

      // Create a list of files to restore
      const filesToRestore = Object.entries(savedFiles).filter(
        ([_, dirent]) => dirent?.type === 'file' && !dirent.isBinary
      );

      // Try up to 3 attempts for each file with increasing delays
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const failedCount = errorCount;
          if (failedCount === 0) break; // No errors, no need for retry

          logger.info(`Retry attempt ${attempt}: waiting before retrying ${failedCount} failed files`);
          await new Promise(resolve => setTimeout(resolve, attempt * 500)); // Increasing delay
          errorCount = 0; // Reset error count for this attempt
        }

        for (const [filePath, dirent] of filesToRestore) {
          // Skip already restored files
          if (this.getFile(filePath)) {
            continue;
          }

          try {
            const relativePath = this.#getRelativePath(filePath, webcontainer.workdir);
            if (!relativePath) {
              logger.warn(`Invalid file path: ${filePath}`);
              errorCount++;
              continue;
            }

            // Write file to the filesystem
            await webcontainer.fs.writeFile(relativePath, (dirent as File).content);
            restoredCount++;

            // Also update our internal state directly in case the watcher doesn't catch it
            this.files.setKey(filePath, dirent);
          } catch (fileErr) {
            // Only count as error if this is the last attempt
            if (attempt === 2) {
              logger.error(`Failed to restore file ${filePath} after multiple attempts:`, fileErr);
              errorCount++;
            } else {
              logger.warn(`Attempt ${attempt + 1} failed for ${filePath}, will retry:`, fileErr);
              retryCount++;
            }
          }
        }
      }

      if (errorCount > 0) {
        toast.warn(`Some files could not be restored (${errorCount}/${filesToRestore.length})`);
      }

      logger.info(`Files restoration complete: ${restoredCount} files restored, ${errorCount} errors, ${retryCount} retries`);
      return restoredCount;
    } catch (error) {
      logger.error('Failed to restore files:', error);
      toast.error('Error restoring files');
      throw error;
    }
  }

  /**
   * Get a relative path that works correctly with WebContainer
   */
  #getRelativePath(filePath: string, workdir: string): string | null {
    try {
      // Handle case where filePath already includes workdir
      if (filePath.startsWith(workdir)) {
        return filePath.slice(workdir.length).replace(/^\/+/, '');
      }

      // Handle case where filePath is already relative
      if (!filePath.startsWith('/')) {
        return filePath;
      }

      // Normal relative path calculation
      const relativePath = nodePath.relative(workdir, filePath);

      // Ensure we don't have path traversal issues
      if (relativePath.startsWith('..')) {
        return null;
      }

      return relativePath;
    } catch (error) {
      logger.error('Error calculating relative path:', error);
      return null;
    }
  }

  async #init() {
    if (this.#initAttempts >= this.#maxInitAttempts) {
      logger.error('Max initialization attempts reached, giving up');
      return;
    }

    this.#initAttempts++;

    try {
      const webcontainer = await this.#webcontainer;

      // Prevent multiple initialization attempts for same session
      if (this.#isWatcherInitialized) {
        return;
      }

      logger.info('Initializing filesystem watcher');

      // Set up the watcher
      const unsubscribe = webcontainer.internal.watchPaths(
        { include: [`${WORK_DIR}/**`], exclude: ['**/node_modules', '.git'], includeContent: true },
        bufferWatchEvents(100, this.#processEventBuffer.bind(this)),
      );

      this.#isWatcherInitialized = true;

      // Immediately scan existing files instead of waiting for watcher events
      await this.scanExistingFiles();

      // For hot reloading scenarios, clean up the watcher when module is replaced
      if (import.meta.hot) {
        import.meta.hot.data.isWatcherInitialized = this.#isWatcherInitialized;
        import.meta.hot.dispose(() => {
          unsubscribe();
        });
      }
    } catch (error) {
      logger.error('Failed to initialize filesystem watcher:', error);
      // Instead of failing completely, retry after a delay
      setTimeout(() => this.#init(), 1000);
    }
  }

  /**
   * Directly scan the WebContainer filesystem to find existing files
   * This ensures we don't depend solely on the watcher for initial file discovery
   */
  async scanExistingFiles() {
    if (this.#isInitialScanInProgress) {
      return;
    }

    this.#isInitialScanInProgress = true;

    try {
      logger.info('Scanning WebContainer filesystem for existing files');
      const webcontainer = await this.#webcontainer;

      // Scan the work directory recursively
      await this.scanDirectory(WORK_DIR, webcontainer);

      logger.info(`Initial file scan complete: found ${this.#size} files`);
    } catch (error) {
      logger.error('Error during initial file scan:', error);
    } finally {
      this.#isInitialScanInProgress = false;
    }
  }

  /**
   * Recursively scan a directory to find all files and folders
   */
  async scanDirectory(directory: string, webcontainer: WebContainer) {
    try {
      const entries = await webcontainer.fs.readdir(directory, { withFileTypes: true });

      // First add this directory itself (unless it's the work directory)
      if (directory !== WORK_DIR) {
        this.files.setKey(directory, { type: 'folder' });
      }

      for (const entry of entries) {
        const fullPath = `${directory}/${entry.name}`;

        // Skip node_modules and .git
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }

        if (entry.isDirectory()) {
          // Add directory
          this.files.setKey(fullPath, { type: 'folder' });

          // Recurse into subdirectory
          await this.scanDirectory(fullPath, webcontainer);
        } else {
          try {
            // Read file content
            const buffer = await webcontainer.fs.readFile(fullPath);

            // Process the file
            const isBinary = isBinaryFile(buffer);
            let content = '';

            if (!isBinary) {
              content = this.#decodeFileContent(buffer);
            }

            // Add to files store
            this.files.setKey(fullPath, { type: 'file', content, isBinary });
            this.#size++;
          } catch (fileErr) {
            logger.warn(`Failed to read file ${fullPath}:`, fileErr);
          }
        }
      }
    } catch (error) {
      logger.warn(`Error scanning directory ${directory}:`, error);
    }
  }

  #processEventBuffer(events: Array<[events: PathWatcherEvent[]]>) {
    const watchEvents = events.flat(2);

    for (const { type, path, buffer } of watchEvents) {
      // remove any trailing slashes
      const sanitizedPath = path.replace(/\/+$/g, '');

      switch (type) {
        case 'add_dir': {
          // we intentionally add a trailing slash so we can distinguish files from folders in the file tree
          this.files.setKey(sanitizedPath, { type: 'folder' });
          break;
        }
        case 'remove_dir': {
          this.files.setKey(sanitizedPath, undefined);

          for (const [direntPath] of Object.entries(this.files.get())) {
            if (direntPath.startsWith(sanitizedPath)) {
              this.files.setKey(direntPath, undefined);
            }
          }

          break;
        }
        case 'add_file':
        case 'change': {
          if (type === 'add_file') {
            this.#size++;
          }

          let content = '';

          /**
           * @note This check is purely for the editor. The way we detect this is not
           * bullet-proof and it's a best guess so there might be false-positives.
           * The reason we do this is because we don't want to display binary files
           * in the editor nor allow to edit them.
           */
          const isBinary = isBinaryFile(buffer);

          if (!isBinary) {
            content = this.#decodeFileContent(buffer);
          }

          this.files.setKey(sanitizedPath, { type: 'file', content, isBinary });

          break;
        }
        case 'remove_file': {
          this.#size--;
          this.files.setKey(sanitizedPath, undefined);
          break;
        }
        case 'update_directory': {
          // we don't care about these events
          break;
        }
      }
    }
  }

  #decodeFileContent(buffer?: Uint8Array) {
    if (!buffer || buffer.byteLength === 0) {
      return '';
    }

    try {
      return utf8TextDecoder.decode(buffer);
    } catch (error) {
      logger.warn('Error decoding file content:', error);
      // Try fallback decoding methods for non-UTF8 text files
      try {
        // Try with ignoring encoding errors
        return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      } catch (fallbackError) {
        logger.error('All decoding methods failed:', fallbackError);
        return '';
      }
    }
  }
}

function isBinaryFile(buffer: Uint8Array | undefined) {
  if (buffer === undefined) {
    return false;
  }

  return getEncoding(convertToBuffer(buffer), { chunkLength: 100 }) === 'binary';
}

/**
 * Converts a `Uint8Array` into a Node.js `Buffer` by copying the prototype.
 * The goal is to avoid expensive copies. It does create a new typed array
 * but that's generally cheap as long as it uses the same underlying
 * array buffer.
 */
function convertToBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}
