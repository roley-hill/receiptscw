import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

const UNDO_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface UndoEntry {
  description: string;
  undoFn: () => Promise<void>;
  timestamp: number;
}

// Per-page singleton stacks keyed by a page identifier
const stacks = new Map<string, UndoEntry[]>();

export function useUndoStack(pageKey: string) {
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;

  // Ensure stack exists
  if (!stacks.has(pageKey)) {
    stacks.set(pageKey, []);
  }

  const pushUndo = useCallback((description: string, undoFn: () => Promise<void>) => {
    const stack = stacks.get(pageKeyRef.current)!;
    stack.push({ description, undoFn, timestamp: Date.now() });
    // Keep stack bounded
    if (stack.length > 50) stack.shift();
  }, []);

  const performUndo = useCallback(async () => {
    const stack = stacks.get(pageKeyRef.current);
    if (!stack || stack.length === 0) return;

    // Pop expired entries from the top
    const now = Date.now();
    while (stack.length > 0 && now - stack[stack.length - 1].timestamp > UNDO_EXPIRY_MS) {
      stack.pop();
    }

    if (stack.length === 0) {
      toast.info("Nothing to undo (actions older than 5 minutes expire)");
      return;
    }

    const entry = stack.pop()!;
    const undoToast = toast.loading(`Undoing: ${entry.description}...`);
    try {
      await entry.undoFn();
      toast.success(`Undone: ${entry.description}`, { id: undoToast });
    } catch (err: any) {
      toast.error(`Undo failed: ${err.message || "Unknown error"}`, { id: undoToast });
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        // Don't intercept if user is typing in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        
        e.preventDefault();
        performUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [performUndo]);

  // Cleanup expired entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const stack = stacks.get(pageKeyRef.current);
      if (!stack) return;
      const now = Date.now();
      while (stack.length > 0 && now - stack[0].timestamp > UNDO_EXPIRY_MS) {
        stack.shift();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return { pushUndo };
}
