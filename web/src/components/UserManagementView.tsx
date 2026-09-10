"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  type User,
} from "@/lib/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { CloseIcon, PlusIcon } from "./icons";

function formatTime(ts?: number): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type EditTarget =
  | { mode: "create" }
  | { mode: "edit"; user: User }
  | { mode: "reset"; user: User }
  | null;

export function UserManagementView({
  currentUserId,
  onBack,
}: {
  currentUserId: string;
  onBack: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<EditTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-background px-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
            title="返回首页"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="text-[16px] font-semibold text-text">用户管理</div>
            <div className="text-[12px] text-faint">管理账号、角色与状态</div>
          </div>
        </div>
        <button
          onClick={() => setTarget({ mode: "create" })}
          className="btn btn-accent text-white"
        >
          <PlusIcon size={14} />
          新增用户
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {error && (
            <div className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-faint">加载中…</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-background">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">用户</th>
                    <th className="px-4 py-2.5 font-medium">角色</th>
                    <th className="px-4 py-2.5 font-medium">状态</th>
                    <th className="px-4 py-2.5 font-medium">创建时间</th>
                    <th className="px-4 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-line last:border-0 hover:bg-surface"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                            {u.avatar?.trim() || (u.nickname ?? u.username).slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate text-text">
                              {u.nickname ?? u.username}
                              {u.id === currentUserId && (
                                <span className="rounded bg-accent-soft px-1 text-[10px] text-accent">
                                  我
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[12px] text-faint">
                              {u.username}
                              {u.email ? ` · ${u.email}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[12px] ${
                            u.role === "admin"
                              ? "bg-accent-soft text-accent"
                              : "bg-surface-2 text-muted"
                          }`}
                        >
                          {u.role === "admin" ? "管理员" : "普通用户"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[12px] ${
                            u.status === "disabled"
                              ? "bg-danger-soft text-danger"
                              : "bg-success-soft text-success"
                          }`}
                        >
                          {u.status === "disabled" ? "已禁用" : "正常"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {formatTime(u.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1 text-xs">
                          <button
                            onClick={() => setTarget({ mode: "edit", user: u })}
                            className="rounded px-2 py-1 text-accent hover:bg-accent-soft"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => setTarget({ mode: "reset", user: u })}
                            className="rounded px-2 py-1 text-muted hover:bg-hover hover:text-text"
                          >
                            重置密码
                          </button>
                          <button
                            onClick={() => setDeleteTarget(u)}
                            disabled={u.id === currentUserId}
                            className="rounded px-2 py-1 text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {target && (
        <UserFormDialog
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除用户"
        message={`确定要删除用户「${deleteTarget?.nickname ?? deleteTarget?.username ?? ""}」吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteUser(deleteTarget.id);
            setDeleteTarget(null);
            refresh();
          } catch (e) {
            alert(`删除失败：${e instanceof Error ? e.message : "未知错误"}`);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function UserFormDialog({
  target,
  onClose,
  onDone,
}: {
  target: Exclude<EditTarget, null>;
  onClose: () => void;
  onDone: () => void;
}) {
  const isCreate = target.mode === "create";
  const isReset = target.mode === "reset";
  const editing = !isCreate && !isReset ? (target as { user: User }).user : null;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setUsername(editing.username);
      setNickname(editing.nickname ?? editing.username);
      setRole(editing.role);
      setStatus(editing.status ?? "active");
      setPassword("");
    } else {
      setUsername("");
      setPassword("");
      setNickname("");
      setRole("user");
      setStatus("active");
    }
    setError(null);
  }, [target]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (isCreate) {
        if (!username.trim()) throw new Error("用户名不能为空");
        if (!password || password.length < 6) throw new Error("密码至少 6 位");
        await createUser({
          username: username.trim(),
          password,
          nickname: nickname.trim() || undefined,
          role,
        });
      } else if (isReset) {
        if (!password || password.length < 6) throw new Error("新密码至少 6 位");
        await resetUserPassword((target as { user: User }).user.id, password);
      } else if (editing) {
        await updateUser(editing.id, {
          nickname: nickname.trim() || undefined,
          role,
          status,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  const title = isCreate ? "新增用户" : isReset ? "重置密码" : "编辑用户";
  const targetUser = !isCreate ? (target as { user: User }).user : null;

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="dialog-panel w-[420px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">{title}</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="p-4">
          {isReset ? (
            <>
              <div className="mb-2 text-xs text-muted">
                为用户「{targetUser?.nickname ?? targetUser?.username}」重置密码
              </div>
              <label className="mb-1 block text-xs text-muted">新密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
            </>
          ) : (
            <>
              {isCreate && (
                <>
                  <label className="mb-1 block text-xs text-muted">用户名</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="登录用户名"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                  />
                  <label className="mb-1 mt-3 block text-xs text-muted">初始密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                  />
                </>
              )}

              <label className="mb-1 mt-3 block text-xs text-muted">昵称</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={isCreate ? "选填，默认同用户名" : "显示名称"}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />

              <label className="mb-1 mt-3 block text-xs text-muted">角色</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "user")}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>

              {!isCreate && (
                <>
                  <label className="mb-1 mt-3 block text-xs text-muted">状态</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as "active" | "disabled")}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
                  >
                    <option value="active">正常</option>
                    <option value="disabled">禁用</option>
                  </select>
                </>
              )}
            </>
          )}

          {error && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="btn btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "提交中…" : isCreate ? "创建" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
