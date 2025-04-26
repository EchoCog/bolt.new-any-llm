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
        unreachable('Expected content to be defined');
      }

      await webcontainer.fs.writeFile(relativePath, content);

      if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent);
      }

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
      logger.info('Restoring files from persistence');
      const webcontainer = await this.#webcontainer;
      let restoredCount = 0;
      let errorCount = 0;

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
          logger.info(`Created directory: ${dir}`);
        } catch (err: any) {
          // Ignore if directory already exists
          if (!err.toString().includes('EEXIST')) {
            logger.warn(`Failed to create directory ${dir}: ${err}`);
          }
        }
      }

      // Then process each file
      for (const [filePath, dirent] of Object.entries(savedFiles)) {
        // Skip if not a file or is binary
        if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
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
          await webcontainer.fs.writeFile(relativePath, dirent.content);
          restoredCount++;

          // We don't need to update the files map directly here
          // The file system watcher will catch the changes and update the state
        } catch (fileErr) {
          logger.error(`Failed to restore file ${filePath}:`, fileErr);
          errorCount++;
        }
      }

      logger.info(`Files restoration complete: ${restoredCount} files restored, ${errorCount} errors`);
      return restoredCount;
    } catch (error) {
      logger.error('Failed to restore files:', error);
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
    const webcontainer = await this.#webcontainer;

    webcontainer.internal.watchPaths(
      { include: [`${WORK_DIR}/**`], exclude: ['**/node_modules', '.git'], includeContent: true },
      bufferWatchEvents(100, this.#processEventBuffer.bind(this)),
    );
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

          for (const [direntPath] of Object.entries(this.files)) {
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
      console.log(error);
      return '';
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
