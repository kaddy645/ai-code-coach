"use client";

import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  History,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  Plus,
  Sparkles,
  Sun,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MarkdownResponse } from "@/components/markdown-response";
import { HISTORY_LIMIT, readHistory, writeHistory } from "@/lib/history";
import {
  SUPPORTED_LANGUAGES,
  type AuditHistoryItem,
  type AuditMode,
  type Language,
  type StreamEvent,
} from "@/lib/types";

const INITIAL_CODE = `function findDuplicates(items: number[]) {
  const duplicates = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i] === items[j] && !duplicates.includes(items[i])) {
        duplicates.push(items[i]);
      }
    }
  }

  return duplicates;
}`;

type ColorTheme = "dark" | "light";
const THEME_STORAGE_KEY = "code-coach.theme.v1";

const LANGUAGE_EXTENSIONS: Record<Language, string> = {
  TypeScript: "ts",
  JavaScript: "js",
  Python: "py",
  Java: "java",
  Go: "go",
  Rust: "rs",
  "C++": "cpp",
  "C#": "cs",
  PHP: "php",
  Ruby: "rb",
  Swift: "swift",
  Kotlin: "kt",
  SQL: "sql",
  "HTML/CSS": "html",
  Other: "txt",
};

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function getHistoryTitle(code: string): string {
  const firstLine = code
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Untitled code review";
  return firstLine.length > 32 ? `${firstLine.slice(0, 32)}…` : firstLine;
}

function parseRefactor(response: string): { code: string; notes: string } {
  const codeMatch = response.match(/```[^\n]*\n([\s\S]*?)(?:```|$)/);
  const notes = response
    .replace(/## Refactored code[\s\S]*?(?=## Why this is better|$)/i, "")
    .replace(/^## Why this is better\s*/i, "")
    .trim();

  return { code: codeMatch?.[1]?.trimEnd() ?? "", notes };
}

function SkeletonLines() {
  return (
    <div className="space-y-7" aria-label="Generating analysis">
      {[0, 1, 2].map((section) => (
        <div key={section} className="space-y-3">
          <div
            className="soft-pulse h-3 w-36 rounded-full bg-white/[0.09]"
            style={{ animationDelay: `${section * 140}ms` }}
          />
          <div className="soft-pulse h-2.5 w-full rounded-full bg-white/[0.055]" />
          <div className="soft-pulse h-2.5 w-11/12 rounded-full bg-white/[0.055]" />
          <div className="soft-pulse h-2.5 w-4/6 rounded-full bg-white/[0.055]" />
        </div>
      ))}
    </div>
  );
}

export function CodeCoachDashboard() {
  const [code, setCode] = useState(INITIAL_CODE);
  const [language, setLanguage] = useState<Language>("TypeScript");
  const [mode, setMode] = useState<AuditMode>("explain");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<AuditHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<ColorTheme>("dark");
  const abortController = useRef<AbortController | null>(null);
  const responsePanelRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => Math.max(code.split("\n").length, 1), [code]);
  const refactor = useMemo(() => parseRefactor(response), [response]);

  useEffect(() => {
    try {
      const savedHistory = readHistory();
      startTransition(() => {
        setHistory(savedHistory);
        setHistoryReady(true);
      });
    } catch {
      startTransition(() => {
        setHistoryNotice("Saved history could not be read from this browser.");
        setHistoryReady(true);
      });
    }
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(THEME_STORAGE_KEY) === "light") {
        document.documentElement.dataset.theme = "light";
        startTransition(() => setTheme("light"));
      }
    } catch {
      startTransition(() => {
        setHistoryNotice(
          "Browser storage is unavailable; theme preferences will not persist.",
        );
      });
    }
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    try {
      writeHistory(history);
    } catch {
      startTransition(() => {
        setHistoryNotice(
          "Browser storage is unavailable; this session will not be saved.",
        );
      });
    }
  }, [history, historyReady]);

  useEffect(() => {
    const panel = responsePanelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [response]);

  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );

  const updateHistory = useCallback((item: AuditHistoryItem) => {
    setHistory((current) =>
      [item, ...current.filter((entry) => entry.id !== item.id)].slice(
        0,
        HISTORY_LIMIT,
      ),
    );
  }, []);

  const analyzeCode = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (isLoading) return;
      if (!code.trim()) {
        setError("Add some code before starting an analysis.");
        return;
      }

      const requestController = new AbortController();
      abortController.current = requestController;
      setIsLoading(true);
      setError("");
      setResponse("");

      try {
        const result = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, language, mode }),
          signal: requestController.signal,
        });

        if (!result.ok) {
          const payload: unknown = await result.json().catch(() => null);
          const message =
            payload &&
            typeof payload === "object" &&
            "message" in payload &&
            typeof payload.message === "string"
              ? payload.message
              : result.status === 429
                ? "Gemini's free-tier limit was reached. Wait a little and try again."
                : "The analysis could not be started. Please try again.";
          throw new Error(message);
        }

        if (!result.body) {
          throw new Error("The browser could not read the streaming response.");
        }

        const reader = result.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        let completeResponse = "";

        const consumeLine = (line: string) => {
          if (!line.trim()) return;
          const item = JSON.parse(line) as StreamEvent;
          if (item.type === "error") throw new Error(item.message);
          if (item.type === "text") {
            completeResponse += item.text;
            setResponse(completeResponse);
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            lines.forEach(consumeLine);
          }
          buffered += decoder.decode();
          if (buffered.trim()) consumeLine(buffered);
        } finally {
          reader.releaseLock();
        }

        if (!completeResponse.trim()) {
          throw new Error("Gemini returned an empty response. Please try again.");
        }

        updateHistory({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          language,
          mode,
          code,
          response: completeResponse,
        });
      } catch (requestError) {
        if (requestController.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Something went wrong while analyzing your code.",
        );
      } finally {
        if (!requestController.signal.aborted) setIsLoading(false);
        if (abortController.current === requestController) {
          abortController.current = null;
        }
      }
    },
    [code, isLoading, language, mode, updateHistory],
  );

  const stopAnalysis = () => {
    abortController.current?.abort();
    setIsLoading(false);
  };

  const loadHistoryItem = (item: AuditHistoryItem) => {
    abortController.current?.abort();
    setCode(item.code);
    setLanguage(item.language);
    setMode(item.mode);
    setResponse(item.response);
    setError("");
    setIsLoading(false);
    setSidebarOpen(false);
  };

  const startNewReview = () => {
    abortController.current?.abort();
    setCode("");
    setResponse("");
    setError("");
    setIsLoading(false);
    setSidebarOpen(false);
  };

  const deleteHistoryItem = (id: string) => {
    setHistory((current) => current.filter((item) => item.id !== id));
  };

  const clearHistory = () => setHistory([]);

  const toggleTheme = () => {
    const nextTheme: ColorTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      setHistoryNotice(
        "Theme changed for this session, but browser storage could not save your preference.",
      );
    }
  };

  const copyRefactor = async () => {
    if (!refactor.code) return;
    try {
      await navigator.clipboard.writeText(refactor.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard access was denied by your browser.");
    }
  };

  const onLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setLanguage(event.target.value as Language);
  };

  return (
    <div className="app-grid min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1680px]">
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-white/[0.07] bg-[#0c0f15] transition-transform duration-300 lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-[72px] items-center justify-between border-b border-white/[0.07] px-5">
            <Link href="/" className="flex items-center gap-3" aria-label="Code Coach home">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c4f268] text-[#11170b] shadow-[0_0_24px_rgba(196,242,104,0.12)]">
                <Braces size={19} strokeWidth={2.3} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold tracking-[-0.02em] text-[#eff1f6]">
                  code coach
                </span>
                <span className="mt-0.5 block text-[10px] tracking-[0.12em] text-[#777f91] uppercase">
                  AI code studio
                </span>
              </span>
            </Link>
            <button
              className="rounded-lg p-2 text-[#7b8394] hover:bg-white/[0.06] hover:text-white lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>

          <div className="px-4 pt-5">
            <button
              onClick={startNewReview}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#c4f268] text-[12px] font-semibold text-[#11170b] transition hover:bg-[#d2fa86] active:scale-[0.98]"
            >
              <Plus size={15} strokeWidth={2.5} />
              New code review
            </button>

            <div className="mb-2 mt-8 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.13em] text-[#727b8d] uppercase">
                <History size={13} />
                Recent history
              </div>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="rounded px-1.5 py-1 text-[10px] text-[#687184] transition hover:text-[#ff8c8c]"
                  aria-label="Clear review history"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="editor-scrollbar flex-1 overflow-y-auto px-3 pb-5">
            {history.length ? (
              <ul className="space-y-1">
                {history.map((item) => (
                  <li key={item.id} className="group relative">
                    <button
                      onClick={() => loadHistoryItem(item)}
                      className="w-full rounded-lg border border-transparent px-2.5 py-2.5 pr-8 text-left transition hover:border-white/[0.07] hover:bg-white/[0.035]"
                    >
                      <span className="flex items-center gap-2">
                        <FileCode2 size={13} className="shrink-0 text-[#9baa7b]" />
                        <span className="truncate text-[11px] font-medium text-[#c5cad5]">
                          {getHistoryTitle(item.code)}
                        </span>
                      </span>
                      <span className="mt-1.5 flex items-center gap-1.5 pl-[21px] text-[10px] text-[#697285]">
                        <span>{item.mode === "explain" ? "Explained" : "Refactored"}</span>
                        <span className="text-[#404654]">·</span>
                        <span>{formatTime(item.createdAt)}</span>
                      </span>
                    </button>
                    <button
                      onClick={() => deleteHistoryItem(item.id)}
                      className="absolute right-2 top-2.5 rounded p-1 text-[#697285] opacity-0 transition hover:bg-white/[0.07] hover:text-[#ff8c8c] group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Delete ${getHistoryTitle(item.code)} from history`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mx-1 rounded-xl border border-dashed border-white/[0.09] px-3 py-5 text-center">
                <Clock3 size={16} className="mx-auto text-[#687184]" />
                <p className="mt-2 text-[11px] font-medium text-[#a2a9b8]">
                  Your reviews live here
                </p>
                <p className="mt-1 text-[10px] leading-4 text-[#697285]">
                  Finished analyses are saved in this browser.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.07] p-4">
            <div className="flex items-center gap-3 rounded-xl bg-white/[0.035] p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d6f59c]/15 bg-[#c4f268]/[0.08] text-[#c4f268]">
                <Zap size={15} fill="currentColor" />
              </span>
              <div>
                <p className="text-[11px] font-medium text-[#d9dce4]">Gemini Flash</p>
                <p className="mt-0.5 text-[10px] text-[#737b8c]">Fast, thoughtful feedback</p>
              </div>
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#9dde5f] shadow-[0_0_9px_#9dde5f]" />
            </div>
            <a
              href="https://ai.google.dev/gemini-api/docs/rate-limits"
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-between px-1 text-[10px] text-[#727b8d] transition hover:text-[#c7ccd6]"
            >
              Free-tier usage limits <ArrowUpRight size={12} />
            </a>
          </div>
        </aside>

        {sidebarOpen && (
          <button
            className="fixed inset-0 z-20 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation overlay"
          />
        )}

        <main className="min-w-0 flex-1">
          <header className="flex h-[72px] items-center justify-between border-b border-white/[0.07] px-4 sm:px-7 lg:px-9">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-2 text-[#9198a8] transition hover:bg-white/[0.06] hover:text-white lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu size={18} />
              </button>
              <div className="hidden items-center gap-2 text-[11px] text-[#687184] sm:flex">
                <span>Workspace</span>
                <span className="text-[#414754]">/</span>
                <span className="text-[#aab0bd]">Code review</span>
                <ChevronDown size={13} className="ml-1" />
              </div>
              <span className="text-[11px] text-[#aab0bd] sm:hidden">Code review</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label="Toggle color theme"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 text-[#a2a9b8] transition hover:bg-white/[0.06] hover:text-white"
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                <span className="hidden text-[10px] font-medium sm:inline">
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </span>
              </button>
              <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9dde5f]" />
                <span className="text-[10px] font-medium text-[#a2a9b8]">
                  Ready to review
                </span>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1390px] px-4 pb-8 pt-8 sm:px-7 sm:pt-10 lg:px-9">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.14em] text-[#a4c76d] uppercase">
                  <Sparkles size={13} />
                  Your AI engineering partner
                </div>
                <h1 className="text-[27px] font-semibold tracking-[-0.045em] text-[#f0f2f7] sm:text-[32px]">
                  Make sense of your code.
                </h1>
                <p className="mt-1.5 text-[12px] text-[#81899a] sm:text-[13px]">
                  Get clarity, catch edge cases, and ship a cleaner version.
                </p>
              </div>
              <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-[#10131b] px-3 py-2 sm:flex">
                <Activity size={14} className="text-[#a4c76d]" />
                <span className="text-[10px] text-[#8d95a6]">Streaming analysis</span>
                <span className="ml-1 rounded bg-[#c4f268]/[0.1] px-1.5 py-0.5 text-[9px] font-semibold text-[#c4f268]">
                  LIVE
                </span>
              </div>
            </div>

            {historyNotice && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-300/[0.06] px-3 py-2 text-[11px] text-amber-100/80">
                <CircleHelp size={14} className="shrink-0 text-amber-300" />
                {historyNotice}
              </div>
            )}

            <form onSubmit={analyzeCode} className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)]">
              <section className="panel-border flex min-h-[580px] min-w-0 flex-col overflow-hidden rounded-2xl bg-[#10131b]/95 shadow-[0_18px_70px_rgba(0,0,0,0.16)]">
                <div className="flex min-h-[58px] items-center justify-between gap-2 border-b border-white/[0.07] px-4 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#a5c66c]/[0.1] text-[#bddb8b]">
                      <Code2 size={15} />
                    </span>
                    <span className="text-[12px] font-medium text-[#e2e5ec]">Your code</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hidden text-[10px] text-[#697285] sm:inline">Language</span>
                    <label className="relative">
                      <span className="sr-only">Programming language</span>
                      <select
                        value={language}
                        onChange={onLanguageChange}
                        disabled={isLoading}
                        className="h-8 appearance-none rounded-md border border-white/[0.09] bg-[#151923] py-0 pl-2.5 pr-7 text-[10px] font-medium text-[#c4c9d4] outline-none transition focus:border-[#c4f268]/40"
                      >
                        {SUPPORTED_LANGUAGES.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#838b9c]"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-between border-b border-white/[0.055] bg-[#0d1017] px-4 py-2 sm:px-5">
                  <div className="flex items-center gap-1 rounded-md bg-white/[0.035] p-0.5">
                    <button
                      type="button"
                      onClick={() => setMode("explain")}
                      disabled={isLoading}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium transition ${
                        mode === "explain"
                          ? "bg-[#20252f] text-[#e6e9f0] shadow-sm"
                          : "text-[#7f8798] hover:text-[#c4c9d4]"
                      }`}
                    >
                      <MessageSquareText size={12} />
                      Explain
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("optimize")}
                      disabled={isLoading}
                      className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium transition ${
                        mode === "optimize"
                          ? "bg-[#20252f] text-[#e6e9f0] shadow-sm"
                          : "text-[#7f8798] hover:text-[#c4c9d4]"
                      }`}
                    >
                      <WandSparkles size={12} />
                      Optimize
                    </button>
                  </div>
                  <span className="font-mono text-[9px] text-[#666f81]">
                    {LANGUAGE_EXTENSIONS[language]}
                  </span>
                </div>

                <div className="flex min-h-0 flex-1 flex-col bg-[#0c0f16]">
                  <div className="editor-scrollbar flex min-h-[360px] flex-1 overflow-auto">
                    <div className="hidden w-12 shrink-0 select-none border-r border-white/[0.045] py-4 text-right font-mono text-[10px] leading-[1.8] text-[#454c5a] sm:block">
                      {Array.from({ length: lineCount }, (_, index) => (
                        <div key={index} className="pr-3">
                          {index + 1}
                        </div>
                      ))}
                    </div>
                    <textarea
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      disabled={isLoading}
                      spellCheck={false}
                      aria-label="Source code to analyze"
                      placeholder="Paste or type a function, component, or snippet…"
                      className="editor-scrollbar min-h-[360px] w-full resize-none bg-transparent px-4 py-4 font-mono text-[11px] leading-[1.8] text-[#c7ced9] outline-none placeholder:text-[#535b6b] sm:px-5"
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5 sm:px-5">
                    <span className="text-[9px] text-[#697285]">
                      {code.length.toLocaleString()} / 20,000 characters
                    </span>
                    <button
                      type="button"
                      onClick={() => setCode("")}
                      disabled={!code || isLoading}
                      className="text-[10px] text-[#747d8e] transition hover:text-[#c7ccd6] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear editor
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-white/[0.07] bg-[#11141c] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex items-center gap-1.5 text-[10px] text-[#727b8d]">
                    <Layers3 size={12} />
                    <span>
                      {mode === "explain"
                        ? "Understand logic, complexity & edge cases"
                        : "Refactor while preserving behavior"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {isLoading && (
                      <button
                        type="button"
                        onClick={stopAnalysis}
                        className="h-10 rounded-lg border border-white/[0.1] px-3 text-[11px] font-medium text-[#adb4c1] transition hover:bg-white/[0.05]"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isLoading || code.length > 20_000}
                      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#c4f268] px-4 text-[11px] font-semibold text-[#11170b] shadow-[0_4px_18px_rgba(170,220,89,0.12)] transition hover:bg-[#d2fa86] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
                    >
                      {isLoading ? (
                        <LoaderCircle size={14} className="animate-spin" />
                      ) : mode === "explain" ? (
                        <Sparkles size={14} />
                      ) : (
                        <WandSparkles size={14} />
                      )}
                      {isLoading
                        ? "Thinking…"
                        : mode === "explain"
                          ? "Explain code"
                          : "Optimize code"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="panel-border flex min-h-[580px] min-w-0 flex-col overflow-hidden rounded-2xl bg-[#10131b]/95 shadow-[0_18px_70px_rgba(0,0,0,0.16)]">
                <div className="flex min-h-[58px] items-center justify-between border-b border-white/[0.07] px-4 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#c4f268]/[0.1] text-[#c4f268]">
                      <Sparkles size={14} />
                    </span>
                    <div>
                      <span className="block text-[12px] font-medium text-[#e2e5ec]">
                        {mode === "explain" ? "Code explanation" : "Optimized version"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoading && (
                      <span className="flex items-center gap-1.5 text-[9px] font-medium text-[#b8dc7e]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b8dc7e]" />
                        STREAMING
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setResponse("")}
                      disabled={!response || isLoading}
                      className="rounded-md p-1.5 text-[#6f788a] transition hover:bg-white/[0.05] hover:text-[#c7ccd6] disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Clear response"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div
                  ref={responsePanelRef}
                  className="response-scrollbar min-h-[420px] flex-1 overflow-y-auto p-4 sm:p-5"
                >
                  {error ? (
                    <div className="flex min-h-[340px] flex-col items-center justify-center text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rose-300/15 bg-rose-300/[0.07] text-rose-200">
                        <CircleHelp size={18} />
                      </span>
                      <h2 className="mt-4 text-[13px] font-semibold text-[#e5e8ef]">
                        We couldn&apos;t finish that review
                      </h2>
                      <p className="mt-2 max-w-[320px] text-[11px] leading-5 text-[#8991a1]">
                        {error}
                      </p>
                      <button
                        type="button"
                        onClick={() => analyzeCode()}
                        disabled={isLoading || !code.trim()}
                        className="mt-4 rounded-lg border border-white/[0.1] px-3 py-2 text-[10px] font-medium text-[#d9dde6] transition hover:bg-white/[0.05] disabled:opacity-40"
                      >
                        Try again
                      </button>
                    </div>
                  ) : isLoading && !response ? (
                    <SkeletonLines />
                  ) : response ? (
                    mode === "optimize" ? (
                      <div className="space-y-5">
                        <div className="grid gap-3">
                          <div className="rounded-xl border border-white/[0.07] bg-[#0c0f16]">
                            <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
                              <span className="flex items-center gap-2 text-[10px] font-medium text-[#9da5b5]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#e6a76c]" />
                                Before
                              </span>
                              <span className="font-mono text-[9px] text-[#697285]">
                                Original
                              </span>
                            </div>
                            <pre className="editor-scrollbar max-h-48 overflow-auto p-3.5 font-mono text-[10px] leading-[1.75] text-[#8992a2]">
                              <code>{code}</code>
                            </pre>
                          </div>
                          <div className="flex justify-center text-[#747e8f]">
                            <ArrowDownToLine size={14} />
                          </div>
                          <div className="rounded-xl border border-[#c4f268]/15 bg-[#10150d]">
                            <div className="flex items-center justify-between border-b border-[#c4f268]/10 px-3.5 py-2.5">
                              <span className="flex items-center gap-2 text-[10px] font-medium text-[#c5e497]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#aade69]" />
                                After
                              </span>
                              <button
                                type="button"
                                onClick={copyRefactor}
                                disabled={!refactor.code}
                                className="flex items-center gap-1.5 rounded px-2 py-1 text-[9px] text-[#91a677] transition hover:bg-white/[0.05] hover:text-[#d0eea2] disabled:opacity-35"
                              >
                                {copied ? <Check size={11} /> : <Copy size={11} />}
                                {copied ? "Copied" : "Copy"}
                              </button>
                            </div>
                            {refactor.code ? (
                              <pre className="editor-scrollbar max-h-64 overflow-auto p-3.5 font-mono text-[10px] leading-[1.8] text-[#cfdbbd]">
                                <code>{refactor.code}</code>
                              </pre>
                            ) : (
                              <div className="space-y-2 p-4">
                                <div className="soft-pulse h-2 w-3/4 rounded-full bg-[#c4f268]/10" />
                                <div className="soft-pulse h-2 w-1/2 rounded-full bg-[#c4f268]/10" />
                              </div>
                            )}
                          </div>
                        </div>
                        {refactor.notes && (
                          <div className="border-t border-white/[0.07] pt-4">
                            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.1em] text-[#a8be82] uppercase">
                              <WandSparkles size={12} />
                              Why it&apos;s better
                            </div>
                            <MarkdownResponse content={refactor.notes} />
                          </div>
                        )}
                        {isLoading && (
                          <span className="inline-block h-3 w-1.5 animate-pulse rounded-sm bg-[#c4f268]" />
                        )}
                      </div>
                    ) : (
                      <div>
                        <MarkdownResponse content={response} />
                        {isLoading && (
                          <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-[#c4f268]" />
                        )}
                      </div>
                    )
                  ) : (
                    <div className="flex min-h-[390px] flex-col items-center justify-center px-5 text-center">
                      <div className="relative flex h-[68px] w-[68px] items-center justify-center rounded-[22px] border border-[#c4f268]/15 bg-[#c4f268]/[0.045]">
                        <span className="absolute inset-2 rounded-[16px] border border-[#c4f268]/[0.08]" />
                        <Sparkles size={24} className="text-[#bddf84]" />
                      </div>
                      <h2 className="mt-5 text-[13px] font-semibold text-[#dfe3eb]">
                        Your next “aha” moment starts here
                      </h2>
                      <p className="mt-2 max-w-[270px] text-[11px] leading-5 text-[#7e8798]">
                        Add a code snippet, choose your mode, and get a clear review that streams as it thinks.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {[
                          { icon: <MessageSquareText size={11} />, label: "Step-by-step" },
                          { icon: <Activity size={11} />, label: "Big O" },
                          { icon: <Zap size={11} />, label: "Edge cases" },
                        ].map((item) => (
                          <span
                            key={item.label}
                            className="flex items-center gap-1.5 rounded-full border border-white/[0.07] px-2.5 py-1.5 text-[9px] text-[#858d9d]"
                          >
                            <span className="text-[#a8c97a]">{item.icon}</span>
                            {item.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex min-h-[44px] items-center justify-between border-t border-white/[0.06] px-4 sm:px-5">
                  <span className="flex items-center gap-1.5 text-[9px] text-[#697285]">
                    <Sparkles size={11} className="text-[#9dbb69]" />
                    AI can make mistakes. Review changes before using them.
                  </span>
                  {response && !isLoading && !error && (
                    <span className="text-[9px] text-[#697285]">Saved to history</span>
                  )}
                </div>
              </section>
            </form>

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-[#5f6879]">
              <span>Code Coach · Built for curious engineers</span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[#99bd67]" />
                Your code is sent securely to Gemini for analysis
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
