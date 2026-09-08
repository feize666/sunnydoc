"use client";

import { useState, useRef, useEffect } from "react";
import { SendIcon, LinkIcon } from "./icons";
import { chatStream, type Citation, type ChatMessage, type WebSource } from "@/lib/api";

interface Message {
  role: "user" | "ai";
  content: string;
  citations?: Citation[];
  webSources?: WebSource[];
  error?: boolean;
}

const initialMessages: Message[] = [
  {
    role: "ai",
    content:
      "你好，我可以基于知识库文档回答，也能联网搜索实时信息。试试问我关于「部署」或「今天天气」相关的内容。",
  },
];

export function AiPanel() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [enableWeb, setEnableWeb] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, loading]);

  // 从消息列表构建对话历史（排除第一条欢迎语，只取最近 8 条）
  const buildHistory = (msgs: Message[]): ChatMessage[] => {
    const real = msgs.slice(1).filter((m) => m.content && !m.error);
    return real.slice(-8).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
  };

  const ask = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);

    // 先加用户消息，再加空的 AI 占位消息
    setMessages((m) => [...m, { role: "user", content: q }, { role: "ai", content: "" }]);
    const aiIndex = messages.length + 1; // user 在 index=len，ai 在 len+1

    const history = buildHistory(messages);

    const updateAi = (updater: (msg: Message) => Message) => {
      setMessages((m) => m.map((msg, i) => (i === aiIndex ? updater(msg) : msg)));
    };

    try {
      await chatStream(q, 5, history, enableWeb, (e) => {
        if (e.type === "citations") {
          updateAi((msg) => ({ ...msg, citations: e.citations ?? [] }));
        } else if (e.type === "sources") {
          updateAi((msg) => ({ ...msg, webSources: e.sources ?? [] }));
        } else if (e.type === "delta") {
          updateAi((msg) => ({ ...msg, content: msg.content + (e.content ?? "") }));
        }
      });
    } catch (e) {
      updateAi((msg) => ({
        ...msg,
        content: `请求失败：${e instanceof Error ? e.message : "未知错误"}，请确认后端服务已启动。`,
        error: true,
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3 text-[13px] font-semibold">
        AI 问答
        <button
          onClick={() => setEnableWeb((v) => !v)}
          className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
            enableWeb
              ? "bg-accent-soft text-accent"
              : "bg-surface-2 text-faint"
          }`}
          title={enableWeb ? "联网搜索已开启（点击关闭）" : "联网搜索已关闭（点击开启）"}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              enableWeb ? "bg-accent" : "bg-faint"
            }`}
          />
          联网
        </button>
      </div>

      <div ref={chatRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 text-[13px] leading-relaxed ${
              msg.role === "user" ? "items-end" : ""
            }`}
          >
            {msg.role === "ai" && (
              <span className="text-[11px] text-faint">知库助手</span>
            )}
            <div
              className={
                msg.role === "user"
                  ? "max-w-[90%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-white"
                  : `max-w-full rounded-xl rounded-bl-sm border px-3 py-2.5 whitespace-pre-wrap ${
                      msg.error ? "border-red-400 bg-red-50 text-red-600" : "border-line bg-background"
                    }`
              }
            >
              {msg.content}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px]">
                  <div className="mb-0.5 text-[10px] text-faint">知识库引用</div>
                  {msg.citations.map((c, j) => (
                    <a
                      key={j}
                      href="#"
                      className="flex items-center gap-1 text-accent hover:underline"
                    >
                      <LinkIcon size={11} />
                      {c.title} · 片段 {c.segment_index + 1}
                    </a>
                  ))}
                </div>
              )}
              {msg.webSources && msg.webSources.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px]">
                  <div className="mb-0.5 text-[10px] text-faint">联网搜索来源</div>
                  {msg.webSources.map((s, j) => (
                    <a
                      key={j}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-accent hover:underline"
                      title={s.title}
                    >
                      <LinkIcon size={11} />
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-1.5 text-[12px] text-faint">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            正在生成回答…
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-line p-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={1}
          placeholder="向知识库提问…（Enter 发送）"
          className="max-h-[120px] flex-1 resize-none rounded-lg border border-line bg-background px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent"
        />
        <button
          onClick={ask}
          disabled={loading}
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          title="发送"
        >
          <SendIcon size={16} />
        </button>
      </div>
    </aside>
  );
}
