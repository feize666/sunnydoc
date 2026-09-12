"use client";

import { useState, type KeyboardEvent } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

/**
 * 带「显示/隐藏明文」切换的密码输入框。
 * 右侧眼睛按钮切换 type=password/text；点击眼睛不抢焦点（onMouseDown preventDefault）。
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  className = "",
  onKeyDown,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
        style={{ paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "隐藏密码" : "显示密码"}
        className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-faint transition-colors hover:text-muted"
      >
        {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
      </button>
    </div>
  );
}
