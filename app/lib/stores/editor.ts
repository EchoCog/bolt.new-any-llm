import { atom, computed, map, type MapStore, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { createScopedLogger } from '~/utils/logger';
import type { FileMap, FilesStore } from './files';

const logger = createScopedLogger('EditorStore');

export type EditorDocuments = Record<string, EditorDocument>;

type SelectedFile = WritableAtom<string | undefined>;

export class EditorStore {
  #filesStore: FilesStore;

  selectedFile: SelectedFile = import.meta.hot?.data.selectedFile ?? atom<string | undefined>();
  documents: MapStore<EditorDocuments> = import.meta.hot?.data.documents ?? map({});

  // Use computed value to always get the current document
  currentDocument = computed([this.documents, this.selectedFile], (documents, selectedFile) => {
    if (!selectedFile) {
      return undefined;
    }

    return documents[selectedFile];
  });

  constructor(filesStore: FilesStore) {
    this.#filesStore = filesStore;

    if (import.meta.hot) {
      import.meta.hot.data.documents = this.documents;
      import.meta.hot.data.selectedFile = this.selectedFile;
    }
  }

  /**
   * Updates document map with file content from the file system
   * @param files Current file map from FilesStore
   */
  setDocuments(files: FileMap) {
    const previousDocuments = this.documents.get();
    let documentsChanged = false;

    // Build new documents object while preserving scroll positions and maintaining references
    // where content hasn't changed
    const newDocuments = Object.fromEntries<EditorDocument>(
      Object.entries(files)
        .map(([filePath, dirent]) => {
          // Skip folders and undefined entries
          if (dirent === undefined || dirent.type === 'folder') {
            return undefined;
          }

          // Skip binary files
          if (dirent.isBinary) {
            return undefined;
          }

          const previousDocument = previousDocuments?.[filePath];

          // If we already have this document and content hasn't changed,
          // preserve the reference to avoid unnecessary rerenders
          if (previousDocument && previousDocument.value === dirent.content) {
            return [filePath, previousDocument] as [string, EditorDocument];
          }

          // Otherwise create a new document object
          documentsChanged = true;
          return [
            filePath,
            {
              value: dirent.content,
              filePath,
              scroll: previousDocument?.scroll,
              isBinary: dirent.isBinary,
            },
          ] as [string, EditorDocument];
        })
        .filter(Boolean) as Array<[string, EditorDocument]>,
    );

    // Check for removed files
    const removedFiles = Object.keys(previousDocuments || {}).filter(
      path => !Object.keys(newDocuments).includes(path)
    );

    if (removedFiles.length > 0) {
      documentsChanged = true;
      logger.debug(`Removed ${removedFiles.length} files from document map`);
    }

    // Only update the store if something actually changed
    if (documentsChanged) {
      this.documents.set(newDocuments);

      // If the currently selected file was removed, clear the selection
      const currentFile = this.selectedFile.get();
      if (currentFile && removedFiles.includes(currentFile)) {
        this.selectedFile.set(undefined);
      }
    }
  }

  /**
   * Updates the selected file in the editor
   * @param filePath Path to the file to select or undefined to clear selection
   */
  setSelectedFile(filePath: string | undefined) {
    // Validate the file exists if a path is provided
    if (filePath) {
      const documents = this.documents.get();
      if (!documents[filePath]) {
        const file = this.#filesStore.getFile(filePath);
        if (!file) {
          logger.warn(`Attempted to select non-existent file: ${filePath}`);
          return;
        }

        // File exists in the filesystem but not in documents, add it
        this.documents.setKey(filePath, {
          value: file.content,
          filePath,
          isBinary: file.isBinary,
        });
      }
    }

    // Update the selected file
    this.selectedFile.set(filePath);
  }

  /**
   * Updates the scroll position for a document
   * @param filePath Path to the file
   * @param position New scroll position
   */
  updateScrollPosition(filePath: string, position: ScrollPosition) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (!documentState) {
      return;
    }

    this.documents.setKey(filePath, {
      ...documentState,
      scroll: position,
    });
  }

  /**
   * Updates the content of a file in the editor
   * @param filePath Path to the file
   * @param newContent New file content
   */
  updateFile(filePath: string, newContent: string) {
    const documents = this.documents.get();
    const documentState = documents[filePath];

    if (!documentState) {
      // File doesn't exist in documents map, create it
      logger.debug(`Creating new document for ${filePath}`);
      this.documents.setKey(filePath, {
        value: newContent,
        filePath,
        isBinary: false,
      });
      return;
    }

    const currentContent = documentState.value;
    const contentChanged = currentContent !== newContent;

    if (contentChanged) {
      this.documents.setKey(filePath, {
        ...documentState,
        value: newContent,
      });
    }
  }

  /**
   * Checks if a file exists in the document map
   * @param filePath Path to check
   * @returns True if the file exists in the documents map
   */
  hasFile(filePath: string): boolean {
    return !!this.documents.get()[filePath];
  }
}
