import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  error?: string;
  insertedCount?: number;
  duplicateCount?: number;
  totalLineItems?: number;
  duplicateContentWarning?: boolean;
  duplicateContentFile?: string;
  duplicateContentCount?: number;
  fileContentHash?: string;
}

interface UploadStoreContextType {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  clearCompleted: () => void;
  cancelledRef: React.MutableRefObject<boolean>;
  cancelExtraction: () => void;
}

const UploadStoreContext = createContext<UploadStoreContextType | null>(null);

export function UploadStoreProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const cancelledRef = useRef(false);

  const clearCompleted = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "done" && f.status !== "error" && f.status !== "cancelled"));
  }, []);

  const cancelExtraction = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return (
    <UploadStoreContext.Provider value={{ files, setFiles, isProcessing, setIsProcessing, clearCompleted, cancelledRef, cancelExtraction }}>
      {children}
    </UploadStoreContext.Provider>
  );
}

export function useUploadStore() {
  const ctx = useContext(UploadStoreContext);
  if (!ctx) throw new Error("useUploadStore must be used within UploadStoreProvider");
  return ctx;
}
