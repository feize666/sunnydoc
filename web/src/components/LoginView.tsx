"use client";

import { useState } from "react";
import { login, setToken, type User } from "@/lib/api";
import { PasswordInput } from "./PasswordInput";
import { AlertIcon } from "./icons";

/* 左侧品牌区的三条能力点（纯展示，不参与交互） */
const HIGHLIGHTS: { title: string; desc: string; icon: React.ReactNode }[] = [
  {
    title: "结构化整理",
    desc: "知识库 / 文件夹 / 标签多级组织",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    title: "AI 问答溯源",
    desc: "回答附引用来源，可逐句回查",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
        <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
    ),
  },
  {
    title: "多形态文档",
    desc: "Markdown、流程图、思维导图、表格",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <path d="M10 6.5h4a1.5 1.5 0 0 1 1.5 1.5v6" />
      </svg>
    ),
  },
];

export function LoginView({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await login(username.trim(), password);
      setToken(res.token);
      onAuthed(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-background">
      {/* —— 左侧品牌区（窄屏隐藏） —— */}
      <aside className="hero-surface hidden w-[46%] max-w-[560px] shrink-0 flex-col justify-between p-10 lg:flex xl:p-12">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/18 text-lg font-bold ring-1 ring-white/25 backdrop-blur-sm">
            知
          </span>
          <div className="leading-tight">
            <div className="text-[17px] font-semibold">知库</div>
            <div className="text-[12px] text-[var(--hero-ink-faint)]">文档知识库</div>
          </div>
        </div>

        <div>
          <h1 className="text-[30px] font-bold leading-[1.25] tracking-tight xl:text-[34px]">
            把零散的文档
            <br />
            变成可检索的知识
          </h1>
          <p className="mt-4 max-w-[380px] text-[14px] leading-relaxed text-[var(--hero-ink-muted)]">
            以文档为核心，支持知识库分级管理、全文检索与 AI 问答，让每一次查找都有据可循。
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--hero-chip-border)] bg-[var(--hero-chip)] text-[var(--hero-ink)] backdrop-blur-sm">
                  {h.icon}
                </span>
                <span className="leading-snug">
                  <span className="block text-[13px] font-medium">{h.title}</span>
                  <span className="mt-0.5 block text-[12px] text-[var(--hero-ink-muted)]">
                    {h.desc}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[var(--hero-ink-faint)]">
          <span className="hero-chip">私有部署</span>
          <span className="hero-chip">数据不出内网</span>
        </div>
      </aside>

      {/* —— 右侧表单区 —— */}
      <main className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="anim-rise-in w-[380px] max-w-full">
          {/* 窄屏下的品牌标识（左栏隐藏时兜底） */}
          <div className="mb-7 flex flex-col items-center gap-3 lg:hidden">
            <span className="logo-mark grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold">
              知
            </span>
            <div className="text-center">
              <div className="text-lg font-semibold text-text">知库</div>
              <div className="mt-0.5 text-xs text-faint">文档知识库</div>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-[22px] font-semibold tracking-tight text-text">欢迎回来</h2>
            <p className="mt-1.5 text-[13px] text-muted">登录后继续访问你的知识库</p>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="login-username"
                className="mb-1.5 block text-[13px] font-medium text-muted"
              >
                用户名
              </label>
              <input
                id="login-username"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="请输入用户名"
                className="input"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-[13px] font-medium text-muted"
              >
                密码
              </label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="请输入密码"
                className="input"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="anim-scale-in flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger"
              >
                <span className="mt-0.5 shrink-0">
                  <AlertIcon size={14} />
                </span>
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-accent mt-1 w-full text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "登录中…" : "登录"}
            </button>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] text-faint">账号由管理员创建</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <p className="mt-3 text-center text-[12px] text-faint">
            如需开通或重置密码，请联系管理员
          </p>
        </div>
      </main>
    </div>
  );
}