import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { FileMap } from '~/lib/stores/files';

const logger = createScopedLogger('ChatHistory');

// Track database initialization status
const dbInitPromise = initDatabase();
let dbInstance: IDBDatabase | undefined;

// Single shared promise for database initialization
export async function initDatabase(): Promise<IDBDatabase | undefined> {
  if (dbInstance) return dbInstance;

  if (typeof indexedDB === 'undefined') {
    logger.error('indexedDB is not available in this environment.');
    return undefined;
  }

  try {
    // Implement exponential backoff for database opening
    const MAX_RETRIES = 3;
    let retryCount = 0;
    let delay = 500; // Start with 500ms delay

    while (retryCount < MAX_RETRIES) {
      try {
        const db = await openDatabaseWithTimeout(2000); // 2 second timeout
        if (db) {
          dbInstance = db;
          return db;
        }

        // If we get here, the open didn't throw but returned undefined
        retryCount++;
        delay *= 2; // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        logger.error(`Database open attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        delay *= 2; // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    logger.error(`Failed to open database after ${MAX_RETRIES} attempts`);
    return undefined;
  } catch (error) {
    logger.error('Fatal error during database initialization:', error);
    return undefined;
  }
}

// Timeout-based database open
function openDatabaseWithTimeout(timeoutMs: number): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      // Set timeout to avoid hanging if the database is blocked
      const timeoutId = setTimeout(() => {
        logger.error('Database open timed out');
        resolve(undefined);
      }, timeoutMs);

      const request = indexedDB.open('boltHistory', 2);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        try {
          const db = (event.target as IDBOpenDBRequest).result;
          const oldVersion = event.oldVersion;

          // Create chats store if it doesn't exist
          if (oldVersion < 1) {
            if (!db.objectStoreNames.contains('chats')) {
              const store = db.createObjectStore('chats', { keyPath: 'id' });
              store.createIndex('id', 'id', { unique: true });
              store.createIndex('urlId', 'urlId', { unique: true });
            }
          }

          // Create files store in version 2
          if (oldVersion < 2 && !db.objectStoreNames.contains('files')) {
            const filesStore = db.createObjectStore('files', { keyPath: 'id' });
            filesStore.createIndex('id', 'id', { unique: true });
          }
        } catch (err) {
          logger.error('Error during database upgrade:', err);
        }
      };

      request.onsuccess = (event: Event) => {
        clearTimeout(timeoutId);
        const db = (event.target as IDBOpenDBRequest).result;

        // Handle database connection errors
        db.onerror = (event) => {
          logger.error('Database error:', (event.target as any).error);
        };

        // Set up version change handler
        db.onversionchange = () => {
          db.close();
          logger.warn('Database version changed, please reload the page');
        };

        logger.info('Successfully opened IndexedDB database');
        resolve(db);
      };

      request.onerror = (event: Event) => {
        clearTimeout(timeoutId);
        const error = (event.target as IDBOpenDBRequest).error;
        logger.error('Error opening IndexedDB database:', error);
        resolve(undefined);
      };

      request.onblocked = () => {
        clearTimeout(timeoutId);
        logger.error('IndexedDB connection blocked - another connection may be open');
        resolve(undefined);
      };
    } catch (err) {
      logger.error('Unexpected error opening IndexedDB:', err);
      resolve(undefined);
    }
  });
}

// Lazily initialize the database when needed
export const db: Promise<IDBDatabase | undefined> = dbInitPromise;

// Chat persistence methods
export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    if (timestamp && isNaN(Date.parse(timestamp))) {
      reject(new Error('Invalid timestamp'));
      return;
    }

    const request = store.put({
      id,
      messages,
      urlId,
      description,
      timestamp: timestamp ?? new Date().toISOString(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// File persistence methods
export interface PersistedFile {
  id: string; // Unique identifier for the file entry
  files: FileMap; // Map of file paths to file content
  timestamp: string; // When the files were saved
  description?: string; // Optional description of the file set
}

export async function saveFiles(
  db: IDBDatabase,
  id: string,
  files: FileMap,
  description?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction('files', 'readwrite');

      // Set up transaction event handlers
      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = (event) => {
        logger.error(`Transaction error while saving files with ID: ${id}`, (event.target as any).error);
        reject((event.target as any).error || new Error('Transaction failed'));
      };

      transaction.onabort = (event) => {
        logger.error(`Transaction aborted while saving files with ID: ${id}`, (event.target as any).error);
        reject((event.target as any).error || new Error('Transaction aborted'));
      };

      const store = transaction.objectStore('files');

      const fileData: PersistedFile = {
        id,
        files,
        timestamp: new Date().toISOString(),
        description,
      };

      const request = store.put(fileData);

      request.onsuccess = () => {
        logger.info(`Put request successful for files with ID: ${id}`);
        // Note: We don't resolve here, we wait for transaction.oncomplete
      };

      request.onerror = (event) => {
        logger.error(`Failed to save files with ID: ${id}`, (event.target as any).error);
        // Note: We don't reject here, the transaction.onerror will handle it
      };
    } catch (error) {
      logger.error('Error in saveFiles:', error);
      reject(error);
    }
  });
}

export async function getFiles(db: IDBDatabase, id: string): Promise<PersistedFile | undefined> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction('files', 'readonly');

      transaction.onerror = (event) => {
        logger.error(`Transaction error while getting files with ID: ${id}`, (event.target as any).error);
        reject((event.target as any).error || new Error('Transaction failed'));
      };

      const store = transaction.objectStore('files');
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as PersistedFile);
        } else {
          resolve(undefined);
        }
      };

      request.onerror = (event) => {
        logger.error(`Failed to get files with ID: ${id}`, (event.target as any).error);
        reject((event.target as any).error);
      };
    } catch (error) {
      logger.error('Error in getFiles:', error);
      reject(error);
    }
  });
}

export async function getAllFileSets(db: IDBDatabase): Promise<PersistedFile[]> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction('files', 'readonly');

      transaction.onerror = (event) => {
        logger.error('Transaction error while getting all file sets', (event.target as any).error);
        reject((event.target as any).error || new Error('Transaction failed'));
      };

      const store = transaction.objectStore('files');
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result as PersistedFile[]);
      };

      request.onerror = (event) => {
        logger.error('Failed to get all file sets', (event.target as any).error);
        reject((event.target as any).error);
      };
    } catch (error) {
      logger.error('Error in getAllFileSets:', error);
      reject(error);
    }
  });
}

export async function deleteFiles(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction('files', 'readwrite');

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = (event) => {
        logger.error(`Transaction error while deleting files with ID: ${id}`, (event.target as any).error);
        reject((event.target as any).error || new Error('Transaction failed'));
      };

      const store = transaction.objectStore('files');
      const request = store.delete(id);

      request.onsuccess = () => {
        logger.info(`Delete request successful for files with ID: ${id}`);
        // Note: We don't resolve here, we wait for transaction.oncomplete
      };

      request.onerror = (event) => {
        logger.error(`Failed to delete files with ID: ${id}`, (event.target as any).error);
        // Note: We don't reject here, the transaction.onerror will handle it
      };
    } catch (error) {
      logger.error('Error in deleteFiles:', error);
      reject(error);
    }
  });
}

// Continue with existing methods
export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');
    const request = store.delete(id);

    request.onsuccess = () => resolve(undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getNextId(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const highestId = request.result.reduce((cur, acc) => Math.max(+cur, +acc), 0);
      resolve(String(+highestId + 1));
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId); // Get a new urlId for the duplicated chat

  await setMessages(
    db,
    newId,
    messages,
    newUrlId, // Use the new urlId
    description,
  );

  return newUrlId; // Return the urlId instead of id for navigation
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp);
}
