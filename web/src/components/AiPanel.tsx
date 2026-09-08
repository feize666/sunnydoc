"use client";

import { useState, useRef, useEffect } from "react";
import { SendIcon, LinkIcon } from "./icons";

interface Message {
  role: "user" | "ai";
  content: string;
  citations?: { doc: string; segment: string }[];
}

const initialMessages: Message[] = [
  {
    role: "ai",
    content:
      "你好，我可以基于知识库中的文档回答你的问题。试试问我关于「部署」或「权限」相关的内容。",
  },
];

export function AiPanel() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages, loading]);

  const ask = () => {
    const q = input.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);

    // 模拟后端检索（后续替换为真实 API 调用）
    setTimeout(() => {
      const docName = q.includes("部署")
        ? "部署指南"
        : q.includes("权限")
          ? "功能指南"
          : "快速开始";
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          content:
            "根据知识库中的文档，以下是相关回答：\n\n这是一条基于检索结果的示例回答，实际接入后端后，这里会展示由大模型结合检索片段生成的答案。",
          citations: [
            { doc: docName, segment: "第 2 段" },
            { doc: docName, segment: "第 5 段" },
          ],
        },
      ]);
      setLoading(false);
    }, 600);
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3 text-[13px] font-semibold">
        AI 问答
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          引用溯源
        </span>
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
                  : "max-w-full rounded-xl rounded-bl-sm border border-line bg-background px-3 py-2.5 whitespace-pre-wrap"
              }
            >
              {msg.content}
              {msg.citations && (
                <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px]">
                  {msg.citations.map((c, j) => (
                    <a
                      key={j}
                      href="#"
                      className="flex items-center gap-1 text-accent hover:underline"
                    >
                      <LinkIcon size={11} />
                      {c.doc} · {c.segment}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-[12px] text-faint">正在检索知识库…</div>
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
