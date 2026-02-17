import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  insertedCount?: number;
  duplicateCount?: number;
  totalLineItems?: number;
}

interface UploadStoreContextType {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  clearCompleted: () => void;
}

const UploadStoreContext = createContext<UploadStoreContextType | null>(null);

export function UploadStoreProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const clearCompleted = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "done" && f.status !== "error"));
  }, []);

  return (
    <UploadStoreContext.Provider value={{ files, setFiles, isProcessing, setIsProcessing, clearCompleted }}>
      {children}
    </UploadStoreContext.Provider>
  );
}

export function useUploadStore() {
  const ctx = useContext(UploadStoreContext);
  if (!ctx) throw new Error("useUploadStore must be used within UploadStoreProvider");
  return ctx;
}
