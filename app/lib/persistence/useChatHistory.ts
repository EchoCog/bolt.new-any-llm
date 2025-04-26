import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  getMessages,
  getNextId,
  getUrlId,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  db as dbPromise
} from './db';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

// Export a mutable reference that will be populated when the promise resolves
export let db: IDBDatabase | undefined = undefined;

// Initialize and resolve the database promise
(async function initDb() {
  if (persistenceEnabled) {
    try {
      db = await dbPromise;
      if (!db) {
        console.warn('Failed to initialize database after multiple attempts');
      }
    } catch (error) {
      console.error('Error initializing database:', error);
    }
  }
})();

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();
  const [dbReady, setDbReady] = useState<boolean>(false);

  // Handle database initialization
  useEffect(() => {
    if (!persistenceEnabled) {
      setDbReady(true);
      return;
    }

    dbPromise.then(database => {
      setDbReady(true);
      if (!database) {
        toast.error('Chat persistence is unavailable. Using memory storage instead.');
      }
    });
  }, []);

  // Handle message fetching when DB is ready
  useEffect(() => {
    if (!dbReady) return;

    if (!db && persistenceEnabled) {
      setReady(true);
      return;
    }

    if (mixedId && db) {
      getMessages(db, mixedId)
        .then((storedMessages) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            const rewindId = searchParams.get('rewindTo');
            const filteredMessages = rewindId
              ? storedMessages.messages.slice(0, storedMessages.messages.findIndex((m) => m.id === rewindId) + 1)
              : storedMessages.messages;

            setInitialMessages(filteredMessages);
            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
          } else {
            navigate('/', { replace: true });
          }

          setReady(true);
        })
        .catch((error) => {
          toast.error(`Failed to load chat: ${error.message}`);
          setReady(true);
        });
    } else {
      setReady(true);
    }
  }, [mixedId, dbReady]);

  return {
    ready: !mixedId || ready,
    initialMessages,
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      try {
        const { firstArtifact } = workbenchStore;

        if (!urlId && firstArtifact?.id) {
          const urlId = await getUrlId(db, firstArtifact.id);

          navigateChat(urlId);
          setUrlId(urlId);
        }

        if (!description.get() && firstArtifact?.title) {
          description.set(firstArtifact?.title);
        }

        if (initialMessages.length === 0 && !chatId.get()) {
          const nextId = await getNextId(db);

          chatId.set(nextId);

          if (!urlId) {
            navigateChat(nextId);
          }
        }

        await setMessages(db, chatId.get() as string, messages, urlId, description.get());
      } catch (error) {
        console.error('Failed to store message history:', error);
        toast.error('Failed to save chat history');
      }
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[]) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
