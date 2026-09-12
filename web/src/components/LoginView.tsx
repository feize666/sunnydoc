"use client";

import { useState } from "react";
import { login, setToken, type User } from "@/lib/api";
import { PasswordInput } from "./PasswordInput";

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
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="w-[360px] max-w-[92vw]">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="logo-mark grid h-14 w-14 place-items-center rounded-2xl text-2xl font-bold">
            知
          </span>
          <div className="text-center">
            <div className="text-lg font-semibold text-text">知库</div>
            <div className="mt-0.5 text-xs text-faint">文档知识库</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
          <div className="border-b border-line px-5 py-3 text-sm font-medium text-text">
            登录
          </div>

          <div className="p-5">
            <label className="mb-1 block text-xs text-muted">用户名</label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />

            <label className="mb-1 mt-3 block text-xs text-muted">密码</label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="请输入密码"
              className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />

            {error && (
              <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-accent mt-4 w-full text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "登录中…" : "登录"}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] text-faint">
          账号由管理员创建，如有需要请联系管理员
        </p>
      </div>
    </div>
  );
}
