// Re-export everything except 'db' which we'll export explicitly
export * from './useChatHistory';
// Export db and other functions from db.ts explicitly to avoid naming conflict
export { getAll, setMessages, getMessages, getMessagesById, getMessagesByUrlId,
         deleteById, getNextId, getUrlId, forkChat, duplicateChat,
         createChatFromMessages, updateChatDescription, db,
         initDatabase, saveFiles, getFiles, getAllFileSets, deleteFiles } from './db';
