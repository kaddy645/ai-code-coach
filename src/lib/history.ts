import {
  SUPPORTED_LANGUAGES,
  type AuditHistoryItem,
  type AuditMode,
  type Language,
} from "@/lib/types";

export const HISTORY_STORAGE_KEY = "code-coach.history.v1";
export const HISTORY_LIMIT = 20;

function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.some((language) => language === value)
  );
}

function isHistoryItem(value: unknown): value is AuditHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "number" &&
    isLanguage(item.language) &&
    (item.mode === "explain" || item.mode === "optimize") &&
    typeof item.code === "string" &&
    typeof item.response === "string"
  );
}

export function readHistory(): AuditHistoryItem[] {
  const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved history has an unexpected format.");
  }

  return parsed.filter(isHistoryItem).slice(0, HISTORY_LIMIT);
}

export function writeHistory(items: AuditHistoryItem[]): void {
  window.localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(items.slice(0, HISTORY_LIMIT)),
  );
}

export function isAuditMode(value: unknown): value is AuditMode {
  return value === "explain" || value === "optimize";
}
