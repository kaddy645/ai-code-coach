export const SUPPORTED_LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Java",
  "Go",
  "Rust",
  "C++",
  "C#",
  "PHP",
  "Ruby",
  "Swift",
  "Kotlin",
  "SQL",
  "HTML/CSS",
  "Other",
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export type AuditMode = "explain" | "optimize";

export interface AuditHistoryItem {
  id: string;
  createdAt: number;
  language: Language;
  mode: AuditMode;
  code: string;
  response: string;
}

export interface StreamTextEvent {
  type: "text";
  text: string;
}

export interface StreamErrorEvent {
  type: "error";
  message: string;
  code: "RATE_LIMIT" | "UPSTREAM_ERROR";
}

export type StreamEvent = StreamTextEvent | StreamErrorEvent;
