"use client";

import { useState, useEffect } from "react";
import { updateMe, changePassword, setToken, type User } from "@/lib/api";
import { CloseIcon } from "./icons";
import { PasswordInput } from "./PasswordInput";

export function ProfileDialog({
  open,
  user,
  onClose,
  onUpdated,
}: {
  open: boolean;
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdDone, setPwdDone] = useState(false);

  useEffect(() => {
    if (open) {
      setNickname(user.nickname ?? user.username);
      setEmail(user.email ?? "");
      setAvatar(user.avatar ?? "");
      setError(null);
      setOldPassword("");
      setNewPassword("");
      setPwdError(null);
      setPwdDone(false);
    }
  }, [open, user]);

  if (!open) return null;

  const handleSave = async () => {
    if (!nickname.trim()) {
      setError("昵称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMe({
        nickname: nickname.trim(),
        email: email.trim() || undefined,
        avatar: avatar.trim() || undefined,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword) {
      setPwdError("请输入旧密码");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPwdError("新密码至少 6 位");
      return;
    }
    setChanging(true);
    setPwdError(null);
    setPwdDone(false);
    try {
      const res = await changePassword(oldPassword, newPassword);
      setToken(res.token);
      setOldPassword("");
      setNewPassword("");
      setPwdDone(true);
    } catch (e) {
      setPwdError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setChanging(false);
    }
  };

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="dialog-panel w-[480px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-sm font-semibold">个人信息</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent">
              {avatar?.trim() || nickname.slice(0, 1) || "知"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">
                {user.username}
              </div>
              <div className="text-xs text-faint">
                {user.role === "admin" ? "管理员" : "普通用户"}
              </div>
            </div>
          </div>

          <label className="mb-1 block text-xs text-muted">昵称</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">邮箱</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="选填"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          <label className="mb-1 mt-3 block text-xs text-muted">
            头像（emoji 或图片 URL，选填）
          </label>
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="选填，留空则显示昵称首字"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />

          {error && (
            <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-accent text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存资料"}
            </button>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 text-sm font-semibold text-text">修改密码</div>
            <label className="mb-1 block text-xs text-muted">旧密码</label>
            <PasswordInput
              value={oldPassword}
              onChange={setOldPassword}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <label className="mb-1 mt-3 block text-xs text-muted">新密码</label>
            <PasswordInput
              value={newPassword}
              onChange={setNewPassword}
              placeholder="至少 6 位"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />

            {pwdError && (
              <div className="mt-2 rounded-md border border-danger/40 bg-danger-soft px-2 py-1.5 text-xs text-danger">
                {pwdError}
              </div>
            )}
            {pwdDone && (
              <div className="mt-2 rounded-md border border-success/40 bg-success-soft px-2 py-1.5 text-xs text-success">
                密码已修改
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                onClick={handleChangePassword}
                disabled={changing}
                className="btn btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {changing ? "修改中…" : "修改密码"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
