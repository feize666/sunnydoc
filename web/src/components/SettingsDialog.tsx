"use client";

import { useEffect, useState } from "react";
import { CloseIcon, CheckIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { getAISettings, updateAISettings, type AISettings } from "@/lib/api";

// 主流供应商预设（base_url 为 OpenAI 兼容端点）
const PROVIDERS: {
  id: string;
  name: string;
  llmBaseUrl: string;
  embeddingBaseUrl: string;
  rerankBaseUrl: string;
  llmModel: string;
  embeddingModel: string;
  rerankModel: string;
  note: string;
}[] = [
  {
    id: "openai",
    name: "OpenAI",
    llmBaseUrl: "https://api.openai.com/v1",
    embeddingBaseUrl: "https://api.openai.com/v1",
    rerankBaseUrl: "",
    llmModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
    rerankModel: "",
    note: "GPT 系列模型",
  },
  {
    id: "qwen",
    name: "通义千问（阿里云）",
    llmBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    embeddingBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    rerankBaseUrl: "https://dashscope.aliyuncs.com/compatible-api/v1",
    llmModel: "qwen3-max",
    embeddingModel: "text-embedding-v4",
    rerankModel: "qwen3-rerank",
    note: "qwen 系列 + 向量 + 精排",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    llmBaseUrl: "https://api.deepseek.com/v1",
    embeddingBaseUrl: "",
    rerankBaseUrl: "",
    llmModel: "deepseek-chat",
    embeddingModel: "",
    rerankModel: "",
    note: "仅提供对话模型",
  },
  {
    id: "zhipu",
    name: "智谱 AI（GLM）",
    llmBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    embeddingBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    rerankBaseUrl: "",
    llmModel: "glm-4-plus",
    embeddingModel: "embedding-3",
    rerankModel: "",
    note: "GLM 系列 + embedding-3",
  },
  {
    id: "moonshot",
    name: "Moonshot（Kimi）",
    llmBaseUrl: "https://api.moonshot.cn/v1",
    embeddingBaseUrl: "",
    rerankBaseUrl: "",
    llmModel: "moonshot-v1-8k",
    embeddingModel: "",
    rerankModel: "",
    note: "仅提供对话模型",
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    llmBaseUrl: "https://api.siliconflow.cn/v1",
    embeddingBaseUrl: "https://api.siliconflow.cn/v1",
    rerankBaseUrl: "https://api.siliconflow.cn/v1",
    llmModel: "Qwen/Qwen2.5-7B-Instruct",
    embeddingModel: "BAAI/bge-large-zh-v1.5",
    rerankModel: "BAAI/bge-reranker-v2-m3",
    note: "开源模型聚合平台",
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    llmBaseUrl: "http://localhost:11434/v1",
    embeddingBaseUrl: "http://localhost:11434/v1",
    rerankBaseUrl: "",
    llmModel: "qwen2.5:7b",
    embeddingModel: "nomic-embed-text",
    rerankModel: "",
    note: "本地部署，key 可留空",
  },
  {
    id: "custom",
    name: "自定义",
    llmBaseUrl: "",
    embeddingBaseUrl: "",
    rerankBaseUrl: "",
    llmModel: "",
    embeddingModel: "",
    rerankModel: "",
    note: "填写任意 OpenAI 兼容端点",
  },
];

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div className="mt-2.5">
      <div className="mb-1 text-[12px] font-medium text-muted">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        spellCheck={false}
        className="h-8 w-full rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent"
      />
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  theme,
  onToggleTheme,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  isAdmin: boolean;
}) {
  const [ai, setAi] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单本地状态
  const [provider, setProvider] = useState("custom");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [rerankBaseUrl, setRerankBaseUrl] = useState("");
  const [rerankModel, setRerankModel] = useState("");

  // 打开时加载配置
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
    setLoading(true);
    getAISettings()
      .then((cfg) => {
        setAi(cfg);
        setProvider(cfg.provider || "custom");
        setLlmBaseUrl(cfg.llm_base_url || "");
        setLlmModel(cfg.llm_model || "");
        setEmbeddingBaseUrl(cfg.embedding_base_url || "");
        setEmbeddingModel(cfg.embedding_model || "");
        setRerankBaseUrl(cfg.rerank_base_url || "");
        setRerankModel(cfg.rerank_model || "");
        // key 显示脱敏值，但不回填到可编辑框（避免误覆盖）
        setLlmApiKey("");
        setEmbeddingApiKey("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载配置失败"))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const applyProvider = (pid: string) => {
    setProvider(pid);
    const p = PROVIDERS.find((x) => x.id === pid);
    if (!p) return;
    if (p.id !== "custom") {
      setLlmBaseUrl(p.llmBaseUrl);
      setLlmModel(p.llmModel);
      setEmbeddingBaseUrl(p.embeddingBaseUrl);
      setEmbeddingModel(p.embeddingModel);
      setRerankBaseUrl(p.rerankBaseUrl);
      setRerankModel(p.rerankModel);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateAISettings({
        provider,
        llm_base_url: llmBaseUrl.trim(),
        llm_api_key: llmApiKey.trim(), // 空串表示保留原 key
        llm_model: llmModel.trim(),
        embedding_base_url: embeddingBaseUrl.trim(),
        embedding_api_key: embeddingApiKey.trim(),
        embedding_model: embeddingModel.trim(),
        rerank_base_url: rerankBaseUrl.trim(),
        rerank_model: rerankModel.trim(),
      });
      setSaved(true);
      setLlmApiKey("");
      setEmbeddingApiKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const currentProvider = PROVIDERS.find((p) => p.id === provider);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[85vh] w-[560px] max-w-[94vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">设置</div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-[13px] font-semibold text-muted">外观</div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
            <div>
              <div className="text-[14px] text-text">主题</div>
              <div className="text-[12px] text-faint">
                当前为{theme === "light" ? "浅色" : "深色"}主题
              </div>
            </div>
            <ThemeToggle
              theme={theme}
              onToggle={onToggleTheme}
              size={18}
              className="h-9 w-9"
            />
          </div>

          <div className="mt-4 text-[13px] font-semibold text-muted">语言</div>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
            <span className="text-[14px] text-text">简体中文</span>
            <span className="text-[12px] text-faint">当前仅支持中文</span>
          </div>

          {/* AI 配置 */}
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold text-muted">AI 配置</div>
              {ai && (
                <div className="flex gap-2 text-[11px] text-faint">
                  <span className={ai.llm_configured ? "text-accent" : ""}>
                    对话{ai.llm_configured ? "已配置" : "未配置"}
                  </span>
                  <span>·</span>
                  <span className={ai.embedding_configured ? "text-accent" : ""}>
                    向量{ai.embedding_configured ? "已配置" : "未配置"}
                  </span>
                </div>
              )}
            </div>

            {!isAdmin && (
              <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] text-faint">
                仅管理员可修改 AI 配置
              </div>
            )}

            {isAdmin && (
              <div className="mt-2 rounded-lg border border-line bg-surface p-3">
                {loading ? (
                  <div className="py-6 text-center text-[13px] text-faint">加载中…</div>
                ) : (
                  <>
                    {/* 供应商 */}
                    <div>
                      <div className="mb-1 text-[12px] font-medium text-muted">供应商</div>
                      <select
                        value={provider}
                        onChange={(e) => applyProvider(e.target.value)}
                        className="h-8 w-full cursor-pointer rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {currentProvider?.note && (
                        <div className="mt-0.5 text-[11px] text-faint">{currentProvider.note}</div>
                      )}
                    </div>

                    {/* 对话模型 */}
                    <div className="mt-3 border-t border-line pt-2 text-[12px] font-semibold text-text">
                      对话模型（LLM）
                    </div>
                    <Field
                      label="API Key"
                      value={llmApiKey}
                      onChange={setLlmApiKey}
                      type="password"
                      placeholder={ai?.llm_api_key ? `已保存（${ai.llm_api_key}），留空则不修改` : "sk-..."}
                    />
                    <Field
                      label="接口地址 Base URL"
                      value={llmBaseUrl}
                      onChange={setLlmBaseUrl}
                      placeholder="https://api.openai.com/v1"
                    />
                    <Field label="模型" value={llmModel} onChange={setLlmModel} placeholder="gpt-4o-mini" />

                    {/* Embedding */}
                    <div className="mt-3 border-t border-line pt-2 text-[12px] font-semibold text-text">
                      向量模型（Embedding）
                    </div>
                    <Field
                      label="API Key"
                      value={embeddingApiKey}
                      onChange={setEmbeddingApiKey}
                      type="password"
                      placeholder={
                        ai?.embedding_api_key
                          ? `已保存（${ai.embedding_api_key}），留空则不修改`
                          : "sk-..."
                      }
                    />
                    <Field
                      label="接口地址 Base URL"
                      value={embeddingBaseUrl}
                      onChange={setEmbeddingBaseUrl}
                      placeholder="https://api.openai.com/v1"
                      hint="留空则仅做关键词检索"
                    />
                    <Field
                      label="模型"
                      value={embeddingModel}
                      onChange={setEmbeddingModel}
                      placeholder="text-embedding-3-small"
                    />

                    {/* Rerank */}
                    <div className="mt-3 border-t border-line pt-2 text-[12px] font-semibold text-text">
                      精排模型（Rerank，可选）
                    </div>
                    <Field
                      label="接口地址 Base URL"
                      value={rerankBaseUrl}
                      onChange={setRerankBaseUrl}
                      placeholder="留空则跳过精排"
                      hint="使用 Embedding 的 API Key"
                    />
                    <Field
                      label="模型"
                      value={rerankModel}
                      onChange={setRerankModel}
                      placeholder="qwen3-rerank"
                    />

                    {error && (
                      <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[12px] text-danger">
                        {error}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-end gap-2">
                      {saved && (
                        <span className="flex items-center gap-1 text-[12px] text-accent">
                          <CheckIcon size={13} />
                          已保存
                        </span>
                      )}
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn btn-sm btn-accent text-white disabled:opacity-50"
                      >
                        {saving ? "保存中…" : "保存配置"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 text-[13px] font-semibold text-muted">关于</div>
          <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="logo-mark grid h-7 w-7 place-items-center rounded-lg text-sm font-bold">
                知
              </span>
              <div className="leading-tight">
                <div className="text-[14px] font-semibold text-text">知库 sunnydoc</div>
                <div className="text-[12px] text-faint">以文档为核心的私有知识库</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
