"use client";

import { useEffect, useState, useMemo, useRef, useCallback, useId } from "react";
import { CloseIcon, CheckIcon, SunIcon, MoonIcon } from "./icons";
import { LogoMark } from "./LogoMark";
import { Tooltip } from "./Tooltip";
import { useModalFocus } from "@/lib/useModalFocus";
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
  getEmbeddingHealth,
  repairEmbeddings,
  type AISettings,
  type CustomProvider,
  type EmbeddingHealth,
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
    llmModel: "qwen-plus",
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
  const id = useId();
  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            type={type}
            spellCheck={false}
            autoComplete="off"
            className={inputClassName || "input"}
          />
        </div>
        {suffix && <div className="flex shrink-0 flex-wrap items-center gap-2">{suffix}</div>}
      </div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function SettingsHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold tracking-tight text-text">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-faint">{description}</p>
      </div>
      {action}
    </div>
  );
}

type FieldGroup = "llm" | "embedding" | "rerank";
type SettingsSection = "general" | "ai" | "search" | "about";
const SETTINGS_SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
  { id: "general", label: "外观与通用", description: "主题与界面语言" },
  { id: "ai", label: "AI 服务", description: "模型、接口与访问密钥" },
  { id: "search", label: "检索与索引", description: "语义检索与向量健康" },
  { id: "about", label: "关于", description: "产品信息与数据存储" },
];

function SettingsSectionIcon({ section }: { section: SettingsSection }) {
  const paths: Record<SettingsSection, React.ReactNode> = {
    general: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    ai: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />,
    search: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[section]}</svg>;
}

export function SettingsDialog({
  open,
  onClose,
  theme,
  onToggleTheme,
  isAdmin,
  /** 以整页形式渲染（阶段 3 的 L2 设置页）。
   *  为什么用 variant 而不是另写一个页面组件：本组件有 **968 行**表单逻辑
   *  （LLM/Embedding/Rerank 三组字段 + 命名预设的增删改 + 连通性测试），
   *  复制一份必然分叉（本项目已因「同一数据两条产出路径」踩过两次）。
   *  variant 只影响**外壳**（overlay/panel vs 整页容器），逻辑零分叉。 */
  variant = "dialog",
  /** 整页形态下的头部操作（如「返回」）。dialog 形态忽略。 */
  pageHeader,
}: {
  open: boolean;
  onClose: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  isAdmin: boolean;
  variant?: "dialog" | "page";
  pageHeader?: (title: string) => React.ReactNode;
}) {
  const [ai, setAi] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>("general");
  const sectionRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});

  // 窄屏分类允许横向滚动，但键盘或程序切换后，当前项不能停在不可见区域。
  // 只滚分类容器，nearest 不会把背后的设置表单一起拉到顶部。
  useEffect(() => {
    const tab = sectionRefs.current[section];
    if (!tab) return;
    const nav = tab.closest("nav");
    if (nav && nav.scrollWidth > nav.clientWidth) {
      tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [section]);

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

  // 向量健康（admin）：缺向量分片 = 语义检索盲区，可在此一键补算
  const [vecHealth, setVecHealth] = useState<EmbeddingHealth | null>(null);
  const [vecLoading, setVecLoading] = useState(false);
  const [vecRepairing, setVecRepairing] = useState(false);
  const [vecRepairMsg, setVecRepairMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [vecError, setVecError] = useState<string | null>(null);

  const loadVectorHealth = useCallback(() => {
    setVecLoading(true);
    setVecError(null);
    getEmbeddingHealth()
      .then(setVecHealth)
      .catch((e) =>
        setVecError(e instanceof Error ? e.message : "检测失败"),
      )
      .finally(() => setVecLoading(false));
  }, []);

  // 遮罩关闭：只在「按下与抬起都在遮罩本身」时才关闭，
  // 避免拖选文字/下拉内容时 mouseup 落在遮罩上误触发关闭。
  const overlayDownOnSelf = useRef(false);

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

  // 向量健康检测（admin）：独立 effect，与 AI 配置的加载态互不干扰
  useEffect(() => {
    if (!open || !isAdmin) return;
    loadVectorHealth();
  }, [open, isAdmin, loadVectorHealth]);

  // 补算缺向量分片（admin，同步长任务：每批 10 个分片一次 API 调用）。
  // 后端只写 vector IS NULL 的行 —— 重复执行不会覆盖已有向量。
  const runRepairEmbeddings = () => {
    setVecRepairing(true);
    setVecRepairMsg(null);
    repairEmbeddings()
      .then((r) => {
        setVecRepairMsg({
          ok: true,
          text: `已修复 ${r.repaired} 个分片（扫描 ${r.scanned}，剩余 ${r.remaining}${
            r.failed ? `，失败 ${r.failed}` : ""
          }）`,
        });
        loadVectorHealth();
      })
      .catch((e) =>
        setVecRepairMsg({
          ok: false,
          text: e instanceof Error ? e.message : "修复失败",
        }),
      )
      .finally(() => setVecRepairing(false));
  };

  // 注意：所有 useState/useMemo/useEffect 等 Hook 必须在早退之前调用，
  // 否则会引起 Hook 顺序变化导致 React 卸载整个应用。
  const isCustom = provider === "custom";
  const matchedCustom = useMemo(
    () => customList.find((p) => p.id === activeCustomId),
    [customList, activeCustomId],
  );
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

  // 整页形态不是模态：交给 useModalFocus 会抢走 Esc（用户按 Esc 期待的是「返回上一级」，
// 而这里会直接关掉整个设置页）。只有弹窗形态才入焦点栈。
  const panelRef = useModalFocus<HTMLDivElement>(
    open && variant === "dialog",
    onClose,
    "系统设置",
  );
  // 内层嵌套框：各自独立入栈，Esc 时先关闭最上层。
  // 用 ref 惰性转发，避免依赖下方才定义的 closeSaveAsDialog（TDZ）。
  const closeSaveAsRef = useRef<() => void>(() => {});
  const saveAsRef = useModalFocus<HTMLDivElement>(
    saveAsDialog,
    () => closeSaveAsRef.current(),
    "另存为命名预设",
  );
  const providerRef = useModalFocus<HTMLDivElement>(
    !!pendingProviderChange,
    () => setPendingProviderChange(null),
    "切换供应商确认",
  );

  if (!open) return null;

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
    if (!cfg.baseUrl || (!cfg.apiKey && !cfg.useSaved)) {
      setTestingMsg((m) => ({
        ...m,
        [group]: { ok: false, text: "请先填写接口地址和 API Key，或先保存已有配置" },
      }));
      return;
    }
    setTestingField(group);
    setTestingMsg((m) => ({ ...m, [group]: null }));
    try {
      const r = await testAISettings({
        base_url: cfg.baseUrl,
        api_key: cfg.apiKey,
        model: groupModel(group),
        group,
        saved: cfg.useSaved,
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
    if (!cfg.baseUrl || (!cfg.apiKey && !cfg.useSaved)) {
      setModelsMsg("请先填写接口地址和 API Key，或先保存已有配置");
      setModelsFor(group);
      setModelsList([]);
      return;
    }
    setModelsFor(group);
    setModelsMsg("");
    setModelsList([]);
    try {
      const r = await fetchAIModels({
        base_url: cfg.baseUrl,
        api_key: cfg.apiKey,
        group,
        saved: cfg.useSaved,
      });
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
  closeSaveAsRef.current = closeSaveAsDialog;

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

  // 组装 provider 下拉项在函数顶部（避免 Hook 顺序变化）

  const groupBaseConfig = (group: FieldGroup) => {
    const editedKey = group === "llm"
      ? llmApiKey.trim()
      : embeddingApiKey.trim() || (group === "rerank" ? llmApiKey.trim() : "");
    const savedKey = !!(ai?.embedding_api_key || ai?.llm_api_key);
    return {
      baseUrl: group === "llm"
        ? llmBaseUrl.trim()
        : group === "embedding"
          ? embeddingBaseUrl.trim()
          : rerankBaseUrl.trim() || llmBaseUrl.trim(),
      apiKey: editedKey,
      // 留空表示复用服务端保存的密钥；绝不把脱敏占位符回传给接口。
      useSaved: !!ai && !editedKey && savedKey,
    };
  };

  const groupModel = (group: FieldGroup) => {
    if (group === "llm") return llmModel.trim();
    if (group === "embedding") return embeddingModel.trim();
    return rerankModel.trim();
  };

  const Note = ({ group }: { group: FieldGroup }) => {
    const m = testingMsg[group];
    if (!m) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={`mt-3 text-[12px] leading-5 ${m.ok ? "text-success" : "text-danger"}`}
      >
        {m.text}
      </div>
    );
  };

  // ---------- 外壳：弹窗 or 整页（阶段 3）----------
  // 内容体（表单）完全共用，只换外层容器与头部。
  const body = (
    <div className="flex min-h-0 flex-1 flex-col bg-surface md:flex-row">
      <nav
        role="tablist"
        aria-label="设置分类"
        aria-orientation="horizontal"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const index = SETTINGS_SECTIONS.findIndex((s) => s.id === section);
          const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
          const next = e.key === "Home" ? 0 : e.key === "End" ? SETTINGS_SECTIONS.length - 1 : (index + delta + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
          setSection(SETTINGS_SECTIONS[next].id);
          document.getElementById(`settings-tab-${SETTINGS_SECTIONS[next].id}`)?.focus();
        }}
        className="settings-nav flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-background px-3 py-2 md:w-60 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-5"
      >
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.id}
            ref={(el) => { sectionRefs.current[item.id] = el; }}
            id={`settings-tab-${item.id}`}
            role="tab"
            aria-selected={section === item.id}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={section === item.id ? 0 : -1}
            data-testid={`settings-tab-${item.id}`}
            onClick={() => setSection(item.id)}
            className={`settings-nav-item ${section === item.id ? "is-active" : ""}`}
          >
            <span className="settings-nav-icon"><SettingsSectionIcon section={item.id} /></span>
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[13px]">{item.label}</span>
              <span className="mt-0.5 hidden text-[11px] font-normal text-faint md:block">{item.description}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-scroll">
        <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          {section === "general" && (
            <section id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general">
              <SettingsHeading title="外观与通用" description="调整界面显示方式，这些设置只影响你的使用体验。" />
              <div className="mt-6 overflow-hidden rounded-lg border border-line bg-background" data-testid="settings-general">
                <div className="px-4 py-5 sm:px-5">
                  <div className="text-[14px] font-medium text-text">界面主题</div>
                  <p className="mt-1 text-[12px] text-faint">选择适合当前环境的显示方式，切换后立即生效。</p>
                  <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label="界面主题">
                    {(["light", "dark"] as const).map((value) => {
                      const active = theme === value;
                      const Icon = value === "light" ? SunIcon : MoonIcon;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={active}
                          data-testid={`settings-theme-${value}`}
                          onClick={() => { if (!active) onToggleTheme(); }}
                          className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                            active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:border-line-strong hover:bg-hover"
                          }`}
                        >
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${active ? "bg-background text-accent" : "bg-surface-2 text-muted"}`}>
                            <Icon size={18} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-[14px] font-medium">
                              {value === "light" ? "浅色" : "深色"}
                              {active && <CheckIcon size={14} />}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-faint">{value === "light" ? "明亮清晰" : "柔和低亮"}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-4 sm:px-5">
                  <div>
                    <div className="text-[14px] font-medium text-text">界面语言</div>
                    <div className="mt-1 text-[12px] text-faint">当前版本提供简体中文界面</div>
                  </div>
                  <span className="rounded-md bg-surface-2 px-2.5 py-1 text-[12px] text-muted">简体中文</span>
                </div>
              </div>
              <p className="mt-4 text-[12px] leading-5 text-faint">主题选择会保存在当前浏览器中，下次打开仍会沿用。</p>
            </section>
          )}

          {section === "ai" && (
            <section id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai">
              <SettingsHeading
                title="AI 服务"
                description="统一配置 AI 助理使用的对话、向量与精排模型。"
                action={ai && (
                  <div className="flex flex-wrap gap-2 text-[11px]" aria-label="AI 配置状态">
                    <span className={`rounded-md px-2 py-1 ${ai.llm_configured ? "bg-success-soft text-success" : "bg-surface-2 text-faint"}`}>
                      对话{ai.llm_configured ? "已配置" : "未配置"}
                    </span>
                    <span className={`rounded-md px-2 py-1 ${ai.embedding_configured ? "bg-success-soft text-success" : "bg-surface-2 text-faint"}`}>
                      向量{ai.embedding_configured ? "已配置" : "未配置"}
                    </span>
                  </div>
                )}
              />

              {!isAdmin ? (
                <div className="mt-6 rounded-lg border border-line bg-background px-5 py-6 text-[13px] text-muted">当前账号可以查看设置，仅管理员可修改 AI 配置。</div>
              ) : loading ? (
                <div className="mt-6 rounded-lg border border-line bg-background py-16 text-center text-[13px] text-faint" role="status">正在加载 AI 配置…</div>
              ) : (
                <>
                  <div className="mt-6 rounded-lg border border-line bg-background p-4 sm:p-5" data-testid="settings-provider">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <label className="field-label" htmlFor="settings-provider">模型供应商</label>
                        <select id="settings-provider" value={provider} onChange={(e) => applyProvider(e.target.value)} className="select">
                          {providerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </div>
                      {isCustom && (
                        <Tooltip content="把当前配置保存为命名预设，便于以后快速切换">
                          <button onClick={openSaveAsDialog} className="btn btn-secondary shrink-0">另存为预设</button>
                        </Tooltip>
                      )}
                      {matchedCustom && isCustom && (
                        <button onClick={() => setConfirmDelete(matchedCustom)} className="btn btn-sm shrink-0 border border-danger/40 text-danger hover:bg-danger-soft">删除预设</button>
                      )}
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-faint">
                      {PROVIDERS.find((p) => p.id === provider)?.note || "已保存的自定义供应商配置，选择后会载入对应接口与模型。"}
                    </p>
                  </div>

                  <div className="mt-5 rounded-lg border border-line bg-background p-4 sm:p-5" data-testid="settings-llm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-[15px] font-semibold text-text">对话模型</h3>
                        <p className="mt-1 text-[12px] text-faint">用于 AI 助理问答、总结和内容生成</p>
                      </div>
                      <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">LLM</span>
                    </div>
                    <div className="mt-5 grid gap-4">
                      <Field label="API Key" value={llmApiKey} onChange={setLlmApiKey} type="password"
                        placeholder={ai?.llm_api_key ? `已保存（${ai.llm_api_key}），重新填写即覆盖，留空则保留` : "sk-..."}
                        hint="密钥仅用于服务端调用，留空不会清除已保存的密钥。" />
                      <Field label="接口地址" value={llmBaseUrl} onChange={setLlmBaseUrl} placeholder="https://api.openai.com/v1"
                        suffix={<>
                          <button onClick={() => runFetchModels("llm")} className="btn btn-sm btn-secondary" title="用 Base URL + API Key 拉取 /models 列表">获取模型</button>
                          <button onClick={() => runTest("llm")} disabled={testingField === "llm"} className="btn btn-sm btn-secondary disabled:opacity-50" title="发送一次最小请求验证连通性">{testingField === "llm" ? "测试中…" : "测试连接"}</button>
                        </>} />
                      <Field label="模型名称" value={llmModel} onChange={setLlmModel} placeholder="gpt-4o-mini / qwen-plus / deepseek-chat" />
                    </div>
                    <Note group="llm" />
                  </div>

                  <div className="mt-5 rounded-lg border border-line bg-background p-4 sm:p-5" data-testid="settings-embedding">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-[15px] font-semibold text-text">向量模型</h3>
                        <p className="mt-1 text-[12px] text-faint">把文档转换为向量，用于语义检索和知识库问答</p>
                      </div>
                      <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">Embedding</span>
                    </div>
                    <div className="mt-5 grid gap-4">
                      <Field label="API Key（可选）" value={embeddingApiKey} onChange={setEmbeddingApiKey} type="password"
                        placeholder={ai?.embedding_api_key ? `已保存（${ai.embedding_api_key}），重新填写即覆盖，留空则保留` : "留空则使用 LLM 的 Key"}
                        hint="与对话服务使用相同供应商时，可复用对话模型的密钥。" />
                      <Field label="接口地址" value={embeddingBaseUrl} onChange={setEmbeddingBaseUrl} placeholder="https://api.openai.com/v1"
                        hint="留空则关闭语义向量能力，仍可使用全文关键词检索。"
                        suffix={<>
                          <button onClick={() => runFetchModels("embedding")} className="btn btn-sm btn-secondary" title="用 Base URL + API Key 拉取 /models 列表">获取模型</button>
                          <button onClick={() => runTest("embedding")} disabled={testingField === "embedding"} className="btn btn-sm btn-secondary disabled:opacity-50" title="发送一次最小请求验证连通性">{testingField === "embedding" ? "测试中…" : "测试连接"}</button>
                        </>} />
                      <Field label="模型名称" value={embeddingModel} onChange={setEmbeddingModel} placeholder="text-embedding-3-small / text-embedding-v4" />
                    </div>
                    <Note group="embedding" />
                  </div>

                  <div className="mt-5 rounded-lg border border-line bg-background p-4 sm:p-5" data-testid="settings-rerank">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-[15px] font-semibold text-text">精排模型 <span className="ml-1 text-[12px] font-normal text-faint">可选</span></h3>
                        <p className="mt-1 text-[12px] text-faint">对检索结果重新排序，提升回答与关键词的相关性</p>
                      </div>
                      <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">Rerank</span>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <Field label="接口地址" value={rerankBaseUrl} onChange={setRerankBaseUrl} placeholder="留空则复用 LLM 接口" hint="复用对话模型的 API Key，无需单独填写。"
                        suffix={<button onClick={() => runTest("rerank")} disabled={testingField === "rerank"} className="btn btn-sm btn-secondary disabled:opacity-50" title="验证 rerank 接口连通性">{testingField === "rerank" ? "测试中…" : "测试连接"}</button>} />
                      <Field label="模型名称" value={rerankModel} onChange={setRerankModel} placeholder="qwen3-rerank / bge-reranker-v2-m3" />
                    </div>
                    <Note group="rerank" />
                  </div>

                  {modelsFor && (
                    <div className="mt-5 rounded-lg border border-line bg-background p-4" data-testid="settings-model-list">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[13px] font-medium text-text">选择{modelsFor === "llm" ? "对话" : "向量"}模型</div>
                        <button onClick={() => { setModelsFor(null); setModelsList([]); setModelsMsg(""); }} className="icon-btn text-faint hover:text-text" aria-label="关闭模型列表"><CloseIcon size={14} /></button>
                      </div>
                      {modelsMsg && <div role="status" className={`mt-2 text-[12px] ${modelsList.length ? "text-faint" : "text-danger"}`}>{modelsMsg}</div>}
                      {modelsList.length > 0 && (
                        <div className="mt-3 max-h-52 overflow-y-auto rounded-md border border-line">
                          {modelsList.map((m) => <button key={m} onClick={() => pickModel(modelsFor, m)} className="block min-h-9 w-full truncate px-3 py-2 text-left font-mono text-[12px] text-text hover:bg-hover">{m}</button>)}
                        </div>
                      )}
                    </div>
                  )}

                  {error && <div role="alert" className="mt-5 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-[12px] text-danger">{error}</div>}
                  <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-background px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
                    <div className="min-w-0 text-[12px] text-faint">
                      {savedTick > 0 && !error ? <span role="status" className="flex items-center gap-1.5 text-success"><CheckIcon size={14} />配置已保存，新对话将使用最新设置</span> : "修改后请保存，再测试实际问答效果。"}
                    </div>
                    <button onClick={handleSave} disabled={saving} data-testid="settings-save" className="btn btn-accent shrink-0 text-white disabled:opacity-50">{saving ? "保存中…" : "保存配置"}</button>
                  </div>
                </>
              )}
            </section>
          )}

          {section === "search" && (
            <section id="settings-panel-search" role="tabpanel" aria-labelledby="settings-tab-search">
              <SettingsHeading title="检索与索引" description="检查语义检索的索引状态，确保文档可以被搜索和 AI 助理找到。" />
              {!isAdmin ? (
                <div className="mt-6 rounded-lg border border-line bg-background px-5 py-6 text-[13px] text-muted">仅管理员可查看与修复向量索引。</div>
              ) : (
                <div className="mt-6 rounded-lg border border-line bg-background p-4 sm:p-5" data-testid="settings-vector-health">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[15px] font-semibold text-text">向量索引健康</h3>
                      <p className="mt-1 text-[12px] leading-5 text-faint">缺少向量的分片不会被语义检索命中，修复过程不会改动文档正文。</p>
                    </div>
                    <button onClick={loadVectorHealth} disabled={vecLoading} className="btn btn-sm btn-secondary shrink-0">{vecLoading ? "检测中…" : "重新检测"}</button>
                  </div>
                  <div className="mt-5 border-t border-line pt-5">
                    {vecLoading ? <div className="py-4 text-[13px] text-faint" role="status">正在检查文档向量索引…</div> : vecHealth ? (
                      <>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className={`text-[16px] font-medium ${vecHealth.supported && vecHealth.missing > 0 ? "text-danger" : "text-success"}`}>
                              {vecHealth.supported ? vecHealth.missing === 0 ? "全部分片已向量化" : `${vecHealth.missing} 个分片缺少向量` : "当前存储不统计缺向量"}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                              <span className="rounded-md bg-surface-2 px-2 py-1">向量服务{vecHealth.embedding_available ? "可用" : "未配置"}</span>
                              <span className="rounded-md bg-surface-2 px-2 py-1">存储 {vecHealth.backend === "db" ? "PostgreSQL" : "JSON"}</span>
                            </div>
                            <p className="mt-3 text-[12px] leading-5 text-faint">
                              {vecHealth.supported && vecHealth.missing > 0 ? "缺少向量的分片无法被语义检索与 AI 助理命中。" : "当前没有发现需要补算的向量分片。"}
                              {!vecHealth.supported ? "JSON 模式无法修复，请配置 PostgreSQL。" : ""}
                              {vecHealth.supported && vecHealth.missing > 0 && !vecHealth.embedding_available ? "请先前往「AI 服务」配置向量模型。" : ""}
                            </p>
                          </div>
                          {vecHealth.supported && vecHealth.missing > 0 && vecHealth.embedding_available && (
                            <button onClick={runRepairEmbeddings} disabled={vecRepairing} className="btn btn-accent shrink-0 text-white disabled:opacity-50">{vecRepairing ? "修复中…" : `修复 ${vecHealth.missing} 个分片`}</button>
                          )}
                        </div>
                        {vecRepairMsg && <div role="status" className={`mt-4 rounded-md px-3 py-2 text-[12px] ${vecRepairMsg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{vecRepairMsg.text}</div>}
                      </>
                    ) : vecError ? <div role="alert" className="text-[12px] text-danger">{vecError}</div> : null}
                  </div>
                </div>
              )}
            </section>
          )}

          {section === "about" && (
            <section id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about">
              <SettingsHeading title="关于 Sunny" description="以文档为核心的私有知识库。" />
              <div className="mt-6 rounded-lg border border-line bg-background p-5 sm:p-6" data-testid="settings-about">
                <div className="flex items-center gap-3">
                  <LogoMark size={40} rounded="rounded-lg" />
                  <div>
                    <div className="text-[18px] font-semibold text-text">Sunny</div>
                    <div className="mt-0.5 text-[12px] text-faint">你的个人知识库</div>
                  </div>
                </div>
                <p className="mt-5 max-w-xl text-[13px] leading-6 text-muted">把分散的笔记、技术资料与项目经验整理在同一个空间，通过全文检索与 AI 助理重新找到并使用它们。</p>
                <dl className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
                  <div><dt className="text-[12px] text-faint">部署方式</dt><dd className="mt-1 text-[13px] text-text">本地私有化部署</dd></div>
                  <div><dt className="text-[12px] text-faint">内容归属</dt><dd className="mt-1 text-[13px] text-text">文档与知识库归当前账号所有</dd></div>
                </dl>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );

  const nestedExtras = (
    <>
    {saveAsDialog && (
      <div
        className="dialog-overlay"
        onMouseDown={(e) => {
          overlayDownOnSelf.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (overlayDownOnSelf.current && e.target === e.currentTarget) closeSaveAsDialog();
          overlayDownOnSelf.current = false;
        }}
      >
        <div
          ref={saveAsRef}
          className="dialog-panel w-[420px] max-w-[92vw] p-4"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-[14px] font-semibold text-text">
            把当前配置另存为命名预设
          </div>
          <div className="mt-2 text-[12px] text-faint">
            命名后可在供应商下拉中快速选择。Key 仅在你输入了新值后才会覆盖到预设。
          </div>
          <label className="field-label mt-3" htmlFor="settings-preset-name">预设名称</label>
          <input
            id="settings-preset-name"
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            placeholder="例如：阿里云正式环境 / 内网 Ollama"
            className="input"
          />
          {saveAsMsg && (
            <div role="alert" className="mt-2 text-[12px] text-danger">{saveAsMsg}</div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={closeSaveAsDialog} className="btn btn-secondary">取消</button>
            <button onClick={doSaveAs} className="btn btn-accent text-white">保存</button>
          </div>
        </div>
      </div>
    )}

    {/* 切换供应商前确认 */}
    {pendingProviderChange && (
      <div
        className="dialog-overlay"
        onMouseDown={(e) => {
          overlayDownOnSelf.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (overlayDownOnSelf.current && e.target === e.currentTarget)
            setPendingProviderChange(null);
          overlayDownOnSelf.current = false;
        }}
      >
        <div
          ref={providerRef}
          className="dialog-panel w-[420px] max-w-[92vw] p-4"
          onMouseDown={(e) => e.stopPropagation()}
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
              className="h-8 rounded-md bg-accent-solid px-3 text-[12px] text-white hover:bg-accent-solid-hover"
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
    </>
  );

  if (variant === "page") {
    // 整页形态：不做模态遮罩、不拦 Esc（Esc 交给外层导航 = 返回上一级）。
    // 宽度不设上限（页面承载长表单），内容区自行滚动。
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {pageHeader ? (
          pageHeader("系统设置")
        ) : (
          <div className="flex h-12 shrink-0 items-center border-b border-line px-4 text-[16px] font-semibold text-text">
            系统设置
          </div>
        )}
        {body}
        {nestedExtras}
      </div>
    );
  }

  return (
    <div
      className="dialog-overlay"
      onMouseDown={(e) => {
        overlayDownOnSelf.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (overlayDownOnSelf.current && e.target === e.currentTarget) onClose();
        overlayDownOnSelf.current = false;
      }}
    >
      <div
        ref={panelRef}
        className="dialog-panel flex max-h-[85vh] w-[640px] max-w-[94vw] flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold text-text">系统设置</div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="icon-btn text-faint hover:text-text"
          >
            <CloseIcon size={15} />
          </button>
        </div>
        {body}
        {nestedExtras}
      </div>
    </div>
  );

}
