import { create } from 'zustand';
import type { Document } from '../types';

interface DocumentStore {
  documents: Record<string, Partial<Document>>;
  updateDocument: (docId: string, changes: Partial<Document>) => void;
  getDocument: (docId: string) => Partial<Document> | undefined;
  applyChanges: (doc: Document) => Document;
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: {},

  updateDocument: (docId: string, changes: Partial<Document>) => {
    set((state) => ({
      documents: {
        ...state.documents,
        [docId]: {
          ...state.documents[docId],
          ...changes,
        },
      },
    }));
  },

  getDocument: (docId: string) => {
    return get().documents[docId];
  },

  applyChanges: (doc: Document) => {
    const changes = get().documents[doc.documentId];
    if (!changes) return doc;
    return { ...doc, ...changes };
  },
}));
