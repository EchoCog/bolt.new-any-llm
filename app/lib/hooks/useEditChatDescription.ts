import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  chatId as chatIdStore,
  description as descriptionStore,
  db as dbPromise,
  updateChatDescription,
  getMessages,
} from '~/lib/persistence';

interface EditChatDescriptionOptions {
  initialDescription?: string;
  customChatId?: string;
  syncWithGlobalStore?: boolean;
}

type EditChatDescriptionHook = {
  editing: boolean;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleBlur: () => Promise<void>;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
  handleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => Promise<void>;
  currentDescription: string;
  toggleEditMode: () => void;
  dbAvailable: boolean | null;
};

/**
 * Hook to manage the state and behavior for editing chat descriptions.
 *
 * Offers functions to:
 * - Switch between edit and view modes.
 * - Manage input changes, blur, and form submission events.
 * - Save updates to IndexedDB and optionally to the global application state.
 *
 * @param {Object} options
 * @param {string} options.initialDescription - The current chat description.
 * @param {string} options.customChatId - Optional ID for updating the description via the sidebar.
 * @param {boolean} options.syncWithGlobalStore - Flag to indicate global description store synchronization.
 * @returns {EditChatDescriptionHook} Methods and state for managing description edits.
 */
export function useEditChatDescription({
  initialDescription = descriptionStore.get()!,
  customChatId,
  syncWithGlobalStore,
}: EditChatDescriptionOptions): EditChatDescriptionHook {
  const chatIdFromStore = useStore(chatIdStore);
  const [editing, setEditing] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(initialDescription);
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null);
  const [chatId, setChatId] = useState<string>();
  const [dbInstance, setDbInstance] = useState<IDBDatabase | undefined>(undefined);

  // Check database availability and initialize the database instance
  useEffect(() => {
    const initDb = async () => {
      try {
        const database = await dbPromise;
        setDbAvailable(!!database);
        setDbInstance(database);
      } catch (error) {
        console.error('Error initializing database:', error);
        setDbAvailable(false);
      }
    };

    initDb();
  }, []);

  useEffect(() => {
    setChatId(customChatId || chatIdFromStore);
  }, [customChatId, chatIdFromStore]);

  useEffect(() => {
    setCurrentDescription(initialDescription);
  }, [initialDescription]);

  const toggleEditMode = useCallback(() => {
    if (!dbAvailable && !editing) {
      toast.warning('Chat persistence is unavailable. Changes won\'t be saved.');
    }
    setEditing((prev) => !prev);
  }, [dbAvailable, editing]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentDescription(e.target.value);
  }, []);

  const fetchLatestDescription = useCallback(async () => {
    if (!dbInstance || !chatId || !dbAvailable) {
      return initialDescription;
    }

    try {
      const chat = await getMessages(dbInstance, chatId);
      return chat?.description || initialDescription;
    } catch (error) {
      console.error('Failed to fetch latest description:', error);
      return initialDescription;
    }
  }, [dbInstance, chatId, initialDescription, dbAvailable]);

  const handleBlur = useCallback(async () => {
    const latestDescription = await fetchLatestDescription();
    setCurrentDescription(latestDescription);
    toggleEditMode();
  }, [fetchLatestDescription, toggleEditMode]);

  const isValidDescription = useCallback((desc: string): boolean => {
    const trimmedDesc = desc.trim();

    if (trimmedDesc === initialDescription) {
      toggleEditMode();
      return false; // No change, skip validation
    }

    const lengthValid = trimmedDesc.length > 0 && trimmedDesc.length <= 100;
    const characterValid = /^[a-zA-Z0-9\s]+$/.test(trimmedDesc);

    if (!lengthValid) {
      toast.error('Description must be between 1 and 100 characters.');
      return false;
    }

    if (!characterValid) {
      toast.error('Description can only contain alphanumeric characters and spaces.');
      return false;
    }

    return true;
  }, [initialDescription, toggleEditMode]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (!isValidDescription(currentDescription)) {
        return;
      }

      if (!dbAvailable) {
        // Even if DB is not available, we can still update the UI state
        if (syncWithGlobalStore) {
          descriptionStore.set(currentDescription);
          toast.info('Description updated in memory only (persistence unavailable)');
        } else {
          toast.error('Chat persistence is not available');
        }
        toggleEditMode();
        return;
      }

      try {
        if (!chatId) {
          toast.error('Chat Id is not available');
          return;
        }

        if (!dbInstance) {
          toast.error('Database is not available');
          return;
        }

        await updateChatDescription(dbInstance, chatId, currentDescription);

        if (syncWithGlobalStore) {
          descriptionStore.set(currentDescription);
        }

        toast.success('Chat description updated successfully');
      } catch (error) {
        toast.error('Failed to update chat description: ' + (error as Error).message);
      }

      toggleEditMode();
    },
    [currentDescription, dbInstance, chatId, dbAvailable, syncWithGlobalStore, toggleEditMode, isValidDescription],
  );

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        await handleBlur();
      }
    },
    [handleBlur],
  );

  return {
    editing,
    handleChange,
    handleBlur,
    handleSubmit,
    handleKeyDown,
    currentDescription,
    toggleEditMode,
    dbAvailable,
  };
}
