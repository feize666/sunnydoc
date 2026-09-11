"use client";

import { useEffect, useState, useMemo } from "react";
import { CloseIcon, CheckIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { ThemeToggle } from "./ThemeToggle";
import {
  ConfirmDialog,
} from "./ConfirmDialog";
import {
  getAISettings,
  updateAISettings,
  testAISettings,
  fetchAIModels,
  listCustomProviders,
  upsertCustomProvider,
  deleteCustomProvider,
  type AISettings,
  type CustomProvider,
} from "@/lib/api";

// 主流供应商预设（base_url 为 OpenAI 兼容端点）
interface ProviderPreset {
  id: string;
  name: string;
  llmBaseUrl: string;
  embeddingBaseUrl: string;
  rerankBaseUrl: string;
  llmModel: string;
  embeddingModel: string;
  rerankModel: string;
  note: string;
}

const PROVIDERS: ProviderPreset[] = [
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
    name: "通义千问（阿里云/百炼）",
    llmBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    embeddingBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    rerankBaseUrl: "https://dashscope.aliyuncs.com/compatible-api/v1",
    llmModel: "qwen3-max",
    embeddingModel: "text-embedding-v4",
    rerankModel: "qwen3-rerank",
    note: "百炼兼容模式（OpenAI 协议）",
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
    note: "填写任意 OpenAI 兼容端点，可另存为命名预设",
  },
];

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
  suffix,
  inputClassName,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  suffix?: React.ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className="mt-2.5">
      <div className="mb-1 text-[12px] font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          spellCheck={false}
          className={
            inputClassName ||
            "h-8 w-full rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent"
          }
        />
        {suffix}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

type FieldGroup = "llm" | "embedding" | "rerank";

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
  const [savedTick, setSavedTick] = useState(0);
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

  // 自定义命名预设
  const [customList, setCustomList] = useState<CustomProvider[]>([]);
  const [activeCustomId, setActiveCustomId] = useState<string>("");

  // 测试/拉模型
  const [testingField, setTestingField] = useState<FieldGroup | null>(null);
  const [testingMsg, setTestingMsg] = useState<
    Record<FieldGroup, { ok: boolean; text: string } | null>
  >({ llm: null, embedding: null, rerank: null });
  const [modelsFor, setModelsFor] = useState<FieldGroup | null>(null);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState<string>("");

  // 命名预设保存对话框
  const [saveAsDialog, setSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsMsg, setSaveAsMsg] = useState<string>("");

  // 切换供应商确认（避免覆盖已编辑的内容）
  const [pendingProviderChange, setPendingProviderChange] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomProvider | null>(null);

  // 打开时加载配置
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    Promise.all([getAISettings(), listCustomProviders()])
      .then(([cfg, cps]) => {
        setAi(cfg);
        setCustomList(cps);
        setProvider(cfg.provider || "custom");
        setLlmBaseUrl(cfg.llm_base_url || "");
        setLlmModel(cfg.llm_model || "");
        setEmbeddingBaseUrl(cfg.embedding_base_url || "");
        setEmbeddingModel(cfg.embedding_model || "");
        setRerankBaseUrl(cfg.rerank_base_url || "");
        setRerankModel(cfg.rerank_model || "");
        setLlmApiKey("");
        setEmbeddingApiKey("");
        // 如果当前 provider 是某个已保存的自定义预设 id，自动选中
        const matched = cps.find((p) => p.id === cfg.provider);
        if (matched) setActiveCustomId(matched.id);
        else setActiveCustomId("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载配置失败"))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const isCustom = provider === "custom";
  const matchedCustom = useMemo(
    () => customList.find((p) => p.id === activeCustomId),
    [customList, activeCustomId],
  );

  const applyProvider = (pid: string) => {
    // 如果改动过 key 或 model，提示
    const dirty =
      llmApiKey.trim() !== "" ||
      embeddingApiKey.trim() !== "" ||
      (llmBaseUrl !== (ai?.llm_base_url || "") && !pid.startsWith("cp-")) ||
      (embeddingBaseUrl !== (ai?.embedding_base_url || "") && !pid.startsWith("cp-"));
    if (dirty && pid !== provider) {
      setPendingProviderChange(pid);
      return;
    }
    doApplyProvider(pid);
  };

  const doApplyProvider = (pid: string) => {
    setProvider(pid);
    setActiveCustomId(""); // 切到非自定义下拉时清掉自定义选中
    // 自定义命名预设
    if (pid.startsWith("cp-")) {
      const cp = customList.find((p) => p.id === pid);
      if (cp) {
        setActiveCustomId(cp.id);
        setLlmBaseUrl(cp.llm_base_url || "");
        setLlmModel(cp.llm_model || "");
        setEmbeddingBaseUrl(cp.embedding_base_url || "");
        setEmbeddingModel(cp.embedding_model || "");
        setRerankBaseUrl(cp.rerank_base_url || "");
        setRerankModel(cp.rerank_model || "");
        // 命名预设的 key 已知解密的实际值（不在前端），无法自动填入；提示用户填
        return;
      }
    }
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
    try {
      await updateAISettings({
        provider,
        llm_base_url: llmBaseUrl.trim(),
        llm_api_key: llmApiKey.trim(),
        llm_model: llmModel.trim(),
        embedding_base_url: embeddingBaseUrl.trim(),
        embedding_api_key: embeddingApiKey.trim(),
        embedding_model: embeddingModel.trim(),
        rerank_base_url: rerankBaseUrl.trim(),
        rerank_model: rerankModel.trim(),
      });
      // 保存后回填完整配置（含脱敏 key），保留用户输入的 base_url/model
      const cfg = await getAISettings();
      setAi(cfg);
      setProvider(cfg.provider || "custom");
      setLlmBaseUrl(cfg.llm_base_url || "");
      setLlmModel(cfg.llm_model || "");
      setEmbeddingBaseUrl(cfg.embedding_base_url || "");
      setEmbeddingModel(cfg.embedding_model || "");
      setRerankBaseUrl(cfg.rerank_base_url || "");
      setRerankModel(cfg.rerank_model || "");
      setLlmApiKey("");
      setEmbeddingApiKey("");
      setSavedTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // ---------- 测试连通性 ----------
  const runTest = async (group: FieldGroup) => {
    const cfg = groupBaseConfig(group);
    if (!cfg.baseUrl || !cfg.apiKey) {
      setTestingMsg((m) => ({
        ...m,
        [group]: { ok: false, text: "请先填写 Base URL 和 API Key" },
      }));
      return;
    }
    setTestingField(group);
    setTestingMsg((m) => ({ ...m, [group]: null }));
    try {
      const r = await testAISettings({
        base_url: cfg.baseUrl,
        api_key: cfg.apiKey,
        model: group === "rerank" ? "" : groupModel(group), // rerank 测试无需 model
      });
      if (r.ok) {
        setTestingMsg((m) => ({
          ...m,
          [group]: { ok: true, text: `连接成功（${r.status}）${r.content ? ` · 回应: ${r.content}` : ""}` },
        }));
      } else {
        setTestingMsg((m) => ({
          ...m,
          [group]: {
            ok: false,
            text: `失败（${r.status}）${r.detail ? ` · ${r.detail}` : ""}`,
          },
        }));
      }
    } catch (e) {
      setTestingMsg((m) => ({
        ...m,
        [group]: { ok: false, text: e instanceof Error ? e.message : "请求异常" },
      }));
    } finally {
      setTestingField(null);
    }
  };

  // ---------- 拉模型列表 ----------
  const runFetchModels = async (group: FieldGroup) => {
    const cfg = groupBaseConfig(group);
    if (!cfg.baseUrl || !cfg.apiKey) {
      setModelsMsg("请先填写 Base URL 和 API Key");
      setModelsFor(group);
      setModelsList([]);
      return;
    }
    setModelsFor(group);
    setModelsMsg("");
    setModelsList([]);
    try {
      const r = await fetchAIModels({ base_url: cfg.baseUrl, api_key: cfg.apiKey });
      if (r.ok) {
        setModelsList(r.models || []);
        setModelsMsg(
          r.models?.length
            ? `找到 ${r.models.length} 个模型，点击选择即可填入`
            : "接口已连通，但未返回模型列表",
        );
      } else {
        setModelsMsg(`失败（${r.status}）${r.detail ? ` · ${r.detail}` : ""}`);
      }
    } catch (e) {
      setModelsMsg(e instanceof Error ? e.message : "请求异常");
    }
  };

  const pickModel = (group: FieldGroup, m: string) => {
    if (group === "llm") setLlmModel(m);
    else if (group === "embedding") setEmbeddingModel(m);
    setModelsFor(null);
    setModelsList([]);
    setModelsMsg("");
  };

  // ---------- 命名预设：另存为 / 加载 / 删除 ----------
  const openSaveAsDialog = () => setSaveAsDialog(true);
  const closeSaveAsDialog = () => {
    setSaveAsDialog(false);
    setSaveAsName("");
    setSaveAsMsg("");
  };

  const doSaveAs = async () => {
    const name = saveAsName.trim();
    if (!name) {
      setSaveAsMsg("请填写预设名称");
      return;
    }
    try {
      const id = matchedCustom?.id || "";
      const r = await upsertCustomProvider({
        id,
        name,
        provider,
        llm_base_url: llmBaseUrl.trim(),
        llm_api_key: llmApiKey.trim(),
        llm_model: llmModel.trim(),
        embedding_base_url: embeddingBaseUrl.trim(),
        embedding_api_key: embeddingApiKey.trim(),
        embedding_model: embeddingModel.trim(),
        rerank_base_url: rerankBaseUrl.trim(),
        rerank_model: rerankModel.trim(),
      });
      const cps = await listCustomProviders();
      setCustomList(cps);
      setActiveCustomId(r.id);
      // r.provider 即返回的脱敏预览（含 id），联动到下拉
      const newProviderId = (r.provider && r.provider.id) || r.id;
      setProvider(typeof newProviderId === "string" ? newProviderId : String(newProviderId));
      closeSaveAsDialog();
    } catch (e) {
      setSaveAsMsg(e instanceof Error ? e.message : "保存失败");
    }
  };

  const doDeleteCustom = async (cp: CustomProvider) => {
    try {
      await deleteCustomProvider(cp.id);
      const cps = await listCustomProviders();
      setCustomList(cps);
      if (activeCustomId === cp.id) setActiveCustomId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setConfirmDelete(null);
    }
  };

  // 组装 provider 下拉项：内置 + 已保存的自定义预设
  const providerOptions = useMemo(() => {
    const opts: { id: string; name: string; isCustom?: boolean }[] = PROVIDERS.map(
      (p) => ({ id: p.id, name: p.name }),
    );
    if (customList.length) {
      for (const cp of customList) {
        opts.push({ id: cp.id, name: `⭐ ${cp.name}`, isCustom: true });
      }
    }
    return opts;
  }, [customList]);

  const groupBaseConfig = (group: FieldGroup) => {
    if (group === "llm") {
      return { baseUrl: llmBaseUrl, apiKey: llmApiKey.trim() || "" };
    }
    if (group === "embedding") {
      // embedding 允许复用 LLM 的 key 作为后备
      return {
        baseUrl: embeddingBaseUrl || llmBaseUrl,
        apiKey: embeddingApiKey.trim() || llmApiKey.trim() || "",
      };
    }
    // rerank
    return { baseUrl: rerankBaseUrl || llmBaseUrl, apiKey: llmApiKey.trim() || "" };
  };

  const groupModel = (group: FieldGroup) => {
    if (group === "llm") return llmModel.trim();
    if (group === "embedding") return embeddingModel.trim();
    return "";
  };

  const Note = ({ group }: { group: FieldGroup }) => {
    const m = testingMsg[group];
    if (!m) return null;
    return (
      <div
        className={`mt-1 text-[11px] ${m.ok ? "text-accent" : "text-danger"}`}
      >
        {m.text}
      </div>
    );
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[85vh] w-[640px] max-w-[94vw] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">系统设置</div>
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
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <div className="mb-1 text-[12px] font-medium text-muted">供应商</div>
                        <select
                          value={provider}
                          onChange={(e) => applyProvider(e.target.value)}
                          className="h-8 w-full cursor-pointer rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none focus:border-accent"
                        >
                          {providerOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {isCustom && (
                        <Tooltip content="把当前配置保存为命名预设，便于以后快速切换">
                          <button
                            onClick={openSaveAsDialog}
                            className="h-8 shrink-0 rounded-md border border-line bg-background px-3 text-[12px] text-text hover:bg-hover"
                          >
                            ⭐ 另存为预设
                          </button>
                        </Tooltip>
                      )}
                      {matchedCustom && isCustom && (
                        <Tooltip content="删除当前命名预设">
                          <button
                            onClick={() => setConfirmDelete(matchedCustom)}
                            className="h-8 shrink-0 rounded-md border border-danger/30 bg-background px-3 text-[12px] text-danger hover:bg-danger/5"
                          >
                            删除
                          </button>
                        </Tooltip>
                      )}
                    </div>
                    {PROVIDERS.find((p) => p.id === provider)?.note && (
                      <div className="mt-0.5 text-[11px] text-faint">
                        {PROVIDERS.find((p) => p.id === provider)?.note}
                      </div>
                    )}

                    {/* 对话模型 */}
                    <div className="mt-3 border-t border-line pt-2 text-[12px] font-semibold text-text">
                      对话模型（LLM）
                    </div>
                    <Field
                      label="API Key"
                      value={llmApiKey}
                      onChange={setLlmApiKey}
                      type="password"
                      placeholder={
                        ai?.llm_api_key
                          ? `已保存（${ai.llm_api_key}），重新填写即覆盖，留空则保留`
                          : "sk-..."
                      }
                    />
                    <Field
                      label="接口地址 Base URL"
                      value={llmBaseUrl}
                      onChange={setLlmBaseUrl}
                      placeholder="https://api.openai.com/v1"
                      suffix={
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => runFetchModels("llm")}
                            className="h-8 rounded-md border border-line bg-background px-2 text-[11px] text-text hover:bg-hover"
                            title="用 Base URL + API Key 拉取 /models 列表"
                          >
                            获取模型
                          </button>
                          <button
                            onClick={() => runTest("llm")}
                            disabled={testingField === "llm"}
                            className="h-8 rounded-md border border-line bg-background px-2 text-[11px] text-text hover:bg-hover disabled:opacity-50"
                            title="发送一次最小请求验证连通性"
                          >
                            {testingField === "llm" ? "测试中…" : "测试连接"}
                          </button>
                        </div>
                      }
                    />
                    <Field
                      label="模型"
                      value={llmModel}
                      onChange={setLlmModel}
                      placeholder="gpt-4o-mini / qwen3-max / deepseek-chat"
                    />
                    <Note group="llm" />

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
                          ? `已保存（${ai.embedding_api_key}），重新填写即覆盖，留空则保留`
                          : "留空则使用 LLM 的 Key"
                      }
                    />
                    <Field
                      label="接口地址 Base URL"
                      value={embeddingBaseUrl}
                      onChange={setEmbeddingBaseUrl}
                      placeholder="https://api.openai.com/v1（留空则仅做关键词检索）"
                      suffix={
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            onClick={() => runFetchModels("embedding")}
                            className="h-8 rounded-md border border-line bg-background px-2 text-[11px] text-text hover:bg-hover"
                            title="用 Base URL + API Key 拉取 /models 列表"
                          >
                            获取模型
                          </button>
                          <button
                            onClick={() => runTest("embedding")}
                            disabled={testingField === "embedding"}
                            className="h-8 rounded-md border border-line bg-background px-2 text-[11px] text-text hover:bg-hover disabled:opacity-50"
                            title="发送一次最小请求验证连通性"
                          >
                            {testingField === "embedding" ? "测试中…" : "测试连接"}
                          </button>
                        </div>
                      }
                    />
                    <Field
                      label="模型"
                      value={embeddingModel}
                      onChange={setEmbeddingModel}
                      placeholder="text-embedding-3-small / text-embedding-v4"
                    />
                    <Note group="embedding" />

                    {/* Rerank */}
                    <div className="mt-3 border-t border-line pt-2 text-[12px] font-semibold text-text">
                      精排模型（Rerank，可选）
                    </div>
                    <Field
                      label="接口地址 Base URL"
                      value={rerankBaseUrl}
                      onChange={setRerankBaseUrl}
                      placeholder="留空则复用 LLM Base URL，跳过精排"
                      hint="使用 LLM 的 API Key（无需单独填）"
                      suffix={
                        <button
                          onClick={() => runTest("rerank")}
                          disabled={testingField === "rerank"}
                          className="h-8 shrink-0 rounded-md border border-line bg-background px-2 text-[11px] text-text hover:bg-hover disabled:opacity-50"
                          title="验证 rerank 接口连通性"
                        >
                          {testingField === "rerank" ? "测试中…" : "测试连接"}
                        </button>
                      }
                    />
                    <Field
                      label="模型"
                      value={rerankModel}
                      onChange={setRerankModel}
                      placeholder="qwen3-rerank / BAAI/bge-reranker-v2-m3"
                    />
                    <Note group="rerank" />

                    {/* 模型下拉选择器（拉取后显示） */}
                    {modelsFor && (
                      <div className="mt-3 rounded-md border border-line bg-background p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-[12px] font-medium text-muted">
                            {modelsFor === "llm" ? "对话" : "向量"}模型列表
                          </div>
                          <button
                            onClick={() => {
                              setModelsFor(null);
                              setModelsList([]);
                              setModelsMsg("");
                            }}
                            className="text-[11px] text-faint hover:text-text"
                          >
                            关闭
                          </button>
                        </div>
                        {modelsMsg && (
                          <div
                            className={`mb-1 text-[11px] ${modelsList.length ? "text-faint" : "text-danger"}`}
                          >
                            {modelsMsg}
                          </div>
                        )}
                        {modelsList.length > 0 && (
                          <div className="max-h-44 overflow-y-auto rounded border border-line">
                            {modelsList.map((m) => (
                              <button
                                key={m}
                                onClick={() => pickModel(modelsFor, m)}
                                className="block w-full truncate px-2 py-1.5 text-left text-[12px] text-text hover:bg-hover"
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {error && (
                      <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[12px] text-danger">
                        {error}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-end gap-2">
                      {savedTick > 0 && !error && (
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

      {/* 命名预设对话框 */}
      {saveAsDialog && (
        <div className="dialog-overlay" onClick={closeSaveAsDialog}>
          <div
            className="dialog-panel w-[420px] max-w-[92vw] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-semibold text-text">
              把当前配置另存为命名预设
            </div>
            <div className="mt-2 text-[12px] text-faint">
              命名后可在供应商下拉中快速选择。Key 仅在你输入了新值后才会覆盖到预设。
            </div>
            <input
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="例如：阿里云正式环境 / 内网 Ollama"
              className="mt-3 h-9 w-full rounded-md border border-line bg-background px-2 text-[13px] text-text outline-none placeholder:text-faint focus:border-accent"
            />
            {saveAsMsg && (
              <div className="mt-2 text-[12px] text-danger">{saveAsMsg}</div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={closeSaveAsDialog}
                className="h-8 rounded-md border border-line bg-background px-3 text-[12px] text-text hover:bg-hover"
              >
                取消
              </button>
              <button
                onClick={doSaveAs}
                className="h-8 rounded-md bg-accent px-3 text-[12px] text-white hover:bg-accent/90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 切换供应商前确认 */}
      {pendingProviderChange && (
        <div className="dialog-overlay" onClick={() => setPendingProviderChange(null)}>
          <div
            className="dialog-panel w-[420px] max-w-[92vw] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[14px] font-semibold text-text">切换供应商会覆盖已编辑内容</div>
            <div className="mt-2 text-[12px] text-faint">
              当前填写的 Base URL / 模型可能与所选供应商预设不同，确认要应用预设吗？
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingProviderChange(null)}
                className="h-8 rounded-md border border-line bg-background px-3 text-[12px] text-text hover:bg-hover"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (pendingProviderChange) doApplyProvider(pendingProviderChange);
                  setPendingProviderChange(null);
                }}
                className="h-8 rounded-md bg-accent px-3 text-[12px] text-white hover:bg-accent/90"
              >
                继续切换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除命名预设确认 */}
      {confirmDelete && (
        <ConfirmDialog
          open
          title="删除命名预设？"
          message={`将永久删除「${confirmDelete.name}」，不影响当前正在使用的供应商。`}
          confirmText="删除"
          onConfirm={() => doDeleteCustom(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
