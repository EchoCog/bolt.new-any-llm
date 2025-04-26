import { toast } from 'react-toastify';
import { createScopedLogger } from '~/utils/logger';
import type { FileMap } from '~/lib/stores/files';
import { chatId, description } from './useChatHistory';
import { db, saveFiles, getFiles, getAllFileSets, deleteFiles } from './db';

const logger = createScopedLogger('FilePersistence');

// Track ongoing persistence operations to prevent concurrent saves on the same ID
const pendingOperations = new Map<string, Promise<any>>();

/**
 * Saves the current set of files to IndexedDB
 * @param files - The file map to save
 * @param description - Optional description for this file set
 * @param forcedId - Force a specific ID for file storage (optional)
 * @returns Promise that resolves to true when saving is complete
 */
export async function saveFilesToStorage(
  files: FileMap,
  description?: string,
  forcedId?: string
): Promise<boolean> {
  // Get the database instance first
  const dbInstance = await db;
  if (!dbInstance) {
    logger.warn('File persistence unavailable - database not initialized');
    return false;
  }

  // Skip saving if there are no files
  if (!files || Object.keys(files).length === 0) {
    logger.info('No files to save to persistence');
    return false;
  }

  try {
    // Use existing chat ID if available, forced ID if provided, or generate a timestamp-based ID
    const id = forcedId || chatId.get() || `files_${Date.now().toString(36)}`;

    // If there's an ongoing operation for this ID, wait for it to finish first
    if (pendingOperations.has(id)) {
      await pendingOperations.get(id);
    }

    // Create a new promise for this operation
    const saveOperation = (async () => {
      try {
        const fileDescription = description || `Files for ${id}`;
        await saveFiles(dbInstance, id, files, fileDescription);
        logger.info(`Files saved with ID: ${id}`);
        return true;
      } catch (error) {
        logger.error(`Save operation failed for ID: ${id}`, error);
        throw error;
      } finally {
        // Clean up the operation from the map when done
        pendingOperations.delete(id);
      }
    })();

    // Store the promise in the pendingOperations map
    pendingOperations.set(id, saveOperation);

    // Wait for the operation to complete
    await saveOperation;
    return true;
  } catch (error) {
    logger.error('Failed to save files to persistence', error);
    toast.error('Failed to save files');
    return false;
  }
}

/**
 * Retrieves the files associated with the current chat or specified ID
 * @param customId - Optional ID to load specific files (defaults to current chat ID)
 * @returns The file map or undefined if not found
 */
export async function loadFilesFromStorage(customId?: string): Promise<FileMap | undefined> {
  const dbInstance = await db;
  if (!dbInstance) {
    logger.warn('File persistence unavailable - database not initialized');
    return undefined;
  }

  try {
    const id = customId || chatId.get();
    if (!id) {
      logger.warn('No ID available to load files');
      return undefined;
    }

    // If there's an ongoing operation for this ID, wait for it to finish first
    if (pendingOperations.has(id)) {
      await pendingOperations.get(id);
    }

    // Try to get files by the ID
    const fileData = await getFiles(dbInstance, id);
    if (fileData) {
      logger.info(`Loaded files with ID: ${id}`);
      return fileData.files;
    }

    // If not found with ID directly, try the chat ID pattern
    // (handles cases where chat ID might be a URL ID or numeric ID)
    if (id.includes('-')) {
      // Try without the suffix part
      const baseId = id.split('-')[0];
      const baseFileData = await getFiles(dbInstance, baseId);
      if (baseFileData) {
        logger.info(`Loaded files with base ID: ${baseId}`);
        return baseFileData.files;
      }
    }

    logger.info(`No saved files found for ID: ${id}`);
    return undefined;
  } catch (error) {
    logger.error('Failed to load files from persistence', error);
    toast.error('Failed to load saved files');
    return undefined;
  }
}

/**
 * Gets all saved file sets
 * @returns Array of file sets with their metadata
 */
export async function getAllSavedFileSets() {
  const dbInstance = await db;
  if (!dbInstance) {
    logger.warn('File persistence unavailable - database not initialized');
    return [];
  }

  try {
    return await getAllFileSets(dbInstance);
  } catch (error) {
    logger.error('Failed to get all file sets', error);
    toast.error('Failed to load file sets');
    return [];
  }
}

/**
 * Deletes a saved file set
 * @param id - ID of the file set to delete
 * @returns Promise resolving to true if successful
 */
export async function deleteFileSet(id: string): Promise<boolean> {
  const dbInstance = await db;
  if (!dbInstance) {
    logger.warn('File persistence unavailable - database not initialized');
    return false;
  }

  // Wait for any ongoing operations on this ID to complete first
  if (pendingOperations.has(id)) {
    try {
      await pendingOperations.get(id);
    } catch (e) {
      // Ignore errors from pending operations
    }
  }

  try {
    await deleteFiles(dbInstance, id);
    logger.info(`Deleted file set with ID: ${id}`);
    return true;
  } catch (error) {
    logger.error(`Failed to delete file set with ID: ${id}`, error);
    toast.error('Failed to delete file set');
    return false;
  }
}

/**
 * Auto-saves the current files
 * @param files - The file map to save
 * @returns Promise resolving to true if successful
 */
export async function autoSaveFiles(files: FileMap): Promise<boolean> {
  // Only auto-save if there's an active chat and files
  if (!chatId.get() || !files || Object.keys(files).length === 0) {
    return false;
  }

  // Get chat name for more descriptive file set
  const chatDesc = description.get() || 'Current chat';
  const autoSaveDesc = `Auto-saved files - ${chatDesc}`;

  return saveFilesToStorage(files, autoSaveDesc);
}

/**
 * Create a backup of the current files with a unique ID
 * @param files - The files to backup
 * @returns The generated backup ID or undefined if failed
 */
export async function createFileBackup(files: FileMap): Promise<string | undefined> {
  const dbInstance = await db;
  if (!dbInstance || !files || Object.keys(files).length === 0) {
    return undefined;
  }

  const backupId = `backup_${Date.now().toString(36)}`;
  const backupDesc = `Backup ${new Date().toLocaleString()}`;

  const success = await saveFilesToStorage(files, backupDesc, backupId);
  return success ? backupId : undefined;
}
