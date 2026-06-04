import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Database,
  ExternalLink,
  FileText,
  History,
  KeyRound,
  Link2,
  Loader2,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Table2,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { CanvasBoard } from "./CanvasBoard";
import type {
  HistoryNode,
  LinkItem,
  LinkKind,
  NotionFilterOperator,
  NotionFilterRule,
  NotionPropertyType,
  Project,
  ProjectStatus,
  SectionDefinition,
  SectionItem,
  SectionSource,
  SectionType,
  TableColumn,
  TableColumnType,
  TableRow
} from "./types";

const statusLabels: Record<ProjectStatus, string> = {
  planning: "계획",
  inProgress: "진행",
  review: "검토",
  blocked: "이슈",
  done: "완료"
};

const sectionTypeLabels: Record<SectionType, string> = {
  nodeHistory: "노드 이력",
  table: "테이블",
  linkBoard: "링크 모음"
};

const columnTypeLabels: Record<TableColumnType, string> = {
  text: "텍스트",
  number: "숫자",
  date: "날짜",
  status: "상태",
  url: "URL",
  checkbox: "체크",
  select: "선택"
};

const notionTypeOptions: NotionPropertyType[] = [
  "title",
  "rich_text",
  "number",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "select",
  "status",
  "multi_select",
  "people",
  "files",
  "formula",
  "created_time",
  "last_edited_time",
  "created_by",
  "last_edited_by"
];

const notionFilterOperators: Array<{ value: NotionFilterOperator; label: string }> = [
  { value: "equals", label: "같음" },
  { value: "does_not_equal", label: "같지 않음" },
  { value: "contains", label: "포함" },
  { value: "does_not_contain", label: "포함 안 함" },
  { value: "starts_with", label: "시작" },
  { value: "ends_with", label: "끝" },
  { value: "is_empty", label: "비어 있음" },
  { value: "is_not_empty", label: "비어 있지 않음" },
  { value: "greater_than", label: "초과" },
  { value: "less_than", label: "미만" },
  { value: "on_or_after", label: "이후/같음" },
  { value: "on_or_before", label: "이전/같음" }
];

const emptyProject: Partial<Project> = {
  name: "",
  client: "",
  line: "",
  equipment: "",
  status: "planning",
  summary: "",
  tags: []
};

const defaultTableColumns: TableColumn[] = [
  { id: "title", label: "제목", type: "text", required: true, notionType: "title" },
  { id: "status", label: "상태", type: "status", notionType: "status" },
  { id: "date", label: "날짜", type: "date", notionType: "date" },
  { id: "link", label: "링크", type: "url", notionType: "url" }
];

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectEditOpen, setProjectEditOpen] = useState(false);
  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [canvasHistoryInsert, setCanvasHistoryInsert] = useState<{
    projectId: string;
    sectionId: string;
    target?: { itemId: string; position: "before" | "after" };
  } | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => readStoredBoolean("project-rail-open", true));
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    readStoredBoolean("project-inspector-open", true)
  );

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) =>
      [project.name, project.client, project.line, project.equipment, project.summary, ...project.tags]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [projects, query]);

  useEffect(() => {
    void reloadProjects();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedProject(null);
      return;
    }

    void api
      .getProject(selectedId)
      .then(setSelectedProject)
      .catch((err: Error) => setError(err.message));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedProject) {
      setSelectedSectionId("");
      return;
    }

    const currentExists = selectedProject.sections.some((section) => section.id === selectedSectionId);
    if (!currentExists) {
      setSelectedSectionId(selectedProject.sections[0]?.id || "");
    }
  }, [selectedProject, selectedSectionId]);

  useEffect(() => {
    window.localStorage.setItem("project-rail-open", String(leftPanelOpen));
  }, [leftPanelOpen]);

  useEffect(() => {
    window.localStorage.setItem("project-inspector-open", String(rightPanelOpen));
  }, [rightPanelOpen]);

  async function reloadProjects(nextSelectedId?: string) {
    setLoading(true);
    setError("");
    try {
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      const nextId = nextSelectedId || selectedId || nextProjects[0]?.id || "";
      setSelectedId(nextId);
      if (nextId) {
        setSelectedProject(await api.getProject(nextId));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(project: Partial<Project>) {
    await runMutation(async () => {
      const created = await api.createProject(password, project);
      setProjectModalOpen(false);
      setNotice("프로젝트가 추가되었습니다.");
      await reloadProjects(created.id);
    });
  }

  async function handleUpdateProject(project: Partial<Project>) {
    if (!selectedProject) return;
    await runMutation(async () => {
      await api.updateProject(password, selectedProject.id, project);
      setNotice("프로젝트 정보가 저장되었습니다.");
      await reloadProjects(selectedProject.id);
    });
  }

  async function handleCreateSection(section: Partial<SectionDefinition>) {
    if (!selectedProject) return;
    await runMutation(async () => {
      await api.createSection(password, selectedProject.id, section);
      setSectionModalOpen(false);
      setNotice("섹션이 추가되었습니다.");
      await reloadProjects(selectedProject.id);
    });
  }

  async function handleUpdateSection(sectionId: string, section: Partial<SectionDefinition>) {
    if (!selectedProject) return;
    await runMutation(async () => {
      await api.updateSection(password, selectedProject.id, sectionId, section);
      setNotice("섹션 설정이 저장되었습니다.");
      await reloadProjects(selectedProject.id);
    });
  }

  async function handleDeleteSection(sectionId: string) {
    if (!selectedProject) return;
    await runMutation(async () => {
      await api.deleteSection(password, selectedProject.id, sectionId);
      setSelectedSectionId("");
      setNotice("섹션이 삭제되었습니다.");
      await reloadProjects(selectedProject.id);
    });
  }

  const handleCanvasAddHistoryNode = useCallback(
    (
      projectId: string,
      sectionId: string,
      target?: { itemId: string; position: "before" | "after" }
    ) => {
      setSelectedId(projectId);
      setSelectedSectionId(sectionId);
      setCanvasHistoryInsert({ projectId, sectionId, target });
    },
    []
  );

  async function handleCreateHistoryFromCanvas(item: Record<string, unknown>) {
    if (!canvasHistoryInsert) return;
    await runMutation(async () => {
      const payload = {
        ...item,
        ...(canvasHistoryInsert.target?.position === "before"
          ? { insertBeforeId: canvasHistoryInsert.target.itemId }
          : {}),
        ...(canvasHistoryInsert.target?.position === "after"
          ? { insertAfterId: canvasHistoryInsert.target.itemId }
          : {})
      };

      await api.createItem(
        password,
        canvasHistoryInsert.projectId,
        canvasHistoryInsert.sectionId,
        payload
      );
      setCanvasHistoryInsert(null);
      setNotice("이력 노드가 추가되었습니다.");
      await reloadProjects(canvasHistoryInsert.projectId);
      setSelectedSectionId(canvasHistoryInsert.sectionId);
    });
  }

  async function runMutation(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedSection = selectedProject?.sections.find((section) => section.id === selectedSectionId);
  const workspaceClassName = `workspace ${leftPanelOpen ? "" : "left-collapsed"}`;
  const canvasViewClassName = `canvas-workspace-view ${rightPanelOpen ? "" : "right-collapsed"}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <PanelLeft size={22} aria-hidden="true" />
          <div>
            <strong>Project Experience</strong>
            <span>상태 포털</span>
          </div>
        </div>
        <div className="topbar-actions">
          <IconButton
            title={leftPanelOpen ? "프로젝트 패널 접기" : "프로젝트 패널 열기"}
            onClick={() => setLeftPanelOpen((open) => !open)}
          >
            <PanelLeft size={18} />
          </IconButton>
          <IconButton
            title={rightPanelOpen ? "상세 패널 접기" : "상세 패널 열기"}
            onClick={() => setRightPanelOpen((open) => !open)}
          >
            <PanelRight size={18} />
          </IconButton>
          <label className="password-field">
            <KeyRound size={16} aria-hidden="true" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="편집 비밀번호"
            />
          </label>
          <IconButton title="새 프로젝트" onClick={() => setProjectModalOpen(true)}>
            <Plus size={18} />
          </IconButton>
          <IconButton title="새로고침" onClick={() => void reloadProjects()}>
            <RefreshCw size={18} />
          </IconButton>
        </div>
      </header>

      <div className={workspaceClassName}>
        {leftPanelOpen ? (
          <aside className="project-rail">
            <div className="panel-title-row">
              <strong>프로젝트</strong>
              <IconButton title="프로젝트 패널 접기" onClick={() => setLeftPanelOpen(false)}>
                <PanelLeft size={17} />
              </IconButton>
            </div>
            <div className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="캔버스 검색"
              />
            </div>

            <div className="project-list">
              {loading ? (
                <StateLine icon={<Loader2 className="spin" size={16} />} text="불러오는 중" />
              ) : (
                filteredProjects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    className={`project-row ${project.id === selectedId ? "active" : ""}`}
                    onClick={() => setSelectedId(project.id)}
                  >
                    <span className={`status-dot ${project.status}`} />
                    <span>
                      <strong>{project.name}</strong>
                      <small>{compactMeta(project)}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>
        ) : (
          <button className="side-tab left" type="button" onClick={() => setLeftPanelOpen(true)}>
            <PanelLeft size={17} />
            프로젝트
          </button>
        )}

        <main className="main-view canvas-main">
          {error && <Banner tone="error" text={error} />}
          {notice && <Banner tone="success" text={notice} />}

          {!selectedProject && !loading ? (
            <EmptyState />
          ) : selectedProject ? (
            <div className={canvasViewClassName}>
              <section className="canvas-stage">
                <div className="canvas-stage-header">
                  <div>
                    <span className="canvas-label">Graphic Canvas</span>
                    <h1>{selectedProject.name}</h1>
                    <p>프로젝트와 섹션을 노드로 연결해서 보고, 드래그/줌/검색으로 파악합니다.</p>
                  </div>
                  <button className="primary-button" type="button" onClick={() => setSectionModalOpen(true)}>
                    <CirclePlus size={18} />
                    섹션 추가
                  </button>
                </div>
                <CanvasBoard
                  projects={projects}
                  selectedProject={selectedProject}
                  selectedSectionId={selectedSectionId}
                  searchQuery={query}
                  onSelectProject={(projectId) => {
                    setSelectedId(projectId);
                    setSelectedSectionId("");
                  }}
                  onSelectSection={(projectId, sectionId) => {
                    setSelectedId(projectId);
                    setSelectedSectionId(sectionId);
                  }}
                  onAddHistoryNode={handleCanvasAddHistoryNode}
                />
              </section>

              {rightPanelOpen ? (
                <aside className="canvas-inspector">
                  <InspectorHeader
                    project={selectedProject}
                    onEditProject={() => setProjectEditOpen(true)}
                    onAddSection={() => setSectionModalOpen(true)}
                    onClose={() => setRightPanelOpen(false)}
                  />
                  {selectedSection ? (
                    <SectionPanel
                      key={selectedSection.id}
                      projectId={selectedProject.id}
                      section={selectedSection}
                      password={password}
                      busy={busy}
                      onBusyChange={setBusy}
                      onError={setError}
                      onNotice={setNotice}
                      onSectionSave={(patch) => void handleUpdateSection(selectedSection.id, patch)}
                      onSectionDelete={() => void handleDeleteSection(selectedSection.id)}
                      onProjectRefresh={() => reloadProjects(selectedProject.id)}
                    />
                  ) : (
                    <ProjectMapOverview
                      project={selectedProject}
                      onSelectSection={(sectionId) => setSelectedSectionId(sectionId)}
                    />
                  )}
                </aside>
              ) : (
                <button className="side-tab right" type="button" onClick={() => setRightPanelOpen(true)}>
                  <PanelRight size={17} />
                  상세
                </button>
              )}
            </div>
          ) : (
            <StateLine icon={<Loader2 className="spin" size={18} />} text="프로젝트를 준비하는 중" />
          )}
        </main>
      </div>

      {projectEditOpen && selectedProject && (
        <Modal title="프로젝트 정보" onClose={() => setProjectEditOpen(false)}>
          <ProjectForm
            project={selectedProject}
            submitLabel="저장"
            busy={busy}
            onSubmit={(project) => {
              setProjectEditOpen(false);
              void handleUpdateProject(project);
            }}
          />
        </Modal>
      )}

      {projectModalOpen && (
        <Modal title="프로젝트 추가" onClose={() => setProjectModalOpen(false)}>
          <ProjectForm
            project={emptyProject}
            submitLabel="추가"
            busy={busy}
            onSubmit={(project) => void handleCreateProject(project)}
          />
        </Modal>
      )}

      {sectionModalOpen && selectedProject && (
        <Modal title="섹션 추가" onClose={() => setSectionModalOpen(false)}>
          <SectionForm
            section={{
              title: "",
              description: "",
              type: "nodeHistory",
              source: "local",
              order: selectedProject.sections.length + 1,
              columns: defaultTableColumns,
              notion: { dataSourceId: "", pageSize: 50, sortDirection: "descending" }
            }}
            submitLabel="추가"
            busy={busy}
            password={password}
            onSubmit={(section) => void handleCreateSection(section)}
          />
        </Modal>
      )}

      {canvasHistoryInsert && (
        <Modal title={canvasHistoryModalTitle(canvasHistoryInsert.target)} onClose={() => setCanvasHistoryInsert(null)}>
          <NodeForm
            busy={busy}
            submitLabel="노드 추가"
            onSubmit={(item) => void handleCreateHistoryFromCanvas(item)}
            onCancel={() => setCanvasHistoryInsert(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function InspectorHeader({
  project,
  onEditProject,
  onAddSection,
  onClose
}: {
  project: Project;
  onEditProject: () => void;
  onAddSection: () => void;
  onClose: () => void;
}) {
  return (
    <div className="inspector-header">
      <div>
        <span className={`status-pill ${project.status}`}>{statusLabels[project.status]}</span>
        <h2>{project.name}</h2>
        <p>{project.summary || "요약 없음"}</p>
        <div className="inspector-project-meta">
          <span>{project.client || "고객 미지정"}</span>
          <span>{project.line || "라인 미지정"}</span>
          <span>{project.equipment || "장비 미지정"}</span>
          <span>업데이트 {formatDate(project.updatedAt)}</span>
        </div>
      </div>
      <div className="inspector-actions">
        <IconButton title="프로젝트 정보 수정" onClick={onEditProject}>
          <Pencil size={18} />
        </IconButton>
        <IconButton title="섹션 추가" onClick={onAddSection}>
          <Plus size={18} />
        </IconButton>
        <IconButton title="상세 패널 접기" onClick={onClose}>
          <PanelRight size={18} />
        </IconButton>
      </div>
    </div>
  );
}

function ProjectMapOverview({
  project,
  onSelectSection
}: {
  project: Project;
  onSelectSection: (sectionId: string) => void;
}) {
  return (
    <section className="project-map-overview">
      <div className="overview-meta">
        <span>{project.client || "고객 미지정"}</span>
        <span>{project.line || "라인 미지정"}</span>
        <span>{project.equipment || "장비 미지정"}</span>
        <span>업데이트 {formatDate(project.updatedAt)}</span>
      </div>
      <div className="overview-section-list">
        {[...project.sections]
          .sort((left, right) => left.order - right.order)
          .map((section) => (
            <button
              key={section.id}
              type="button"
              className="overview-section-row"
              onClick={() => onSelectSection(section.id)}
            >
              {sectionIcon(section)}
              <span>
                <strong>{section.title}</strong>
                <small>
                  {sectionTypeLabels[section.type]} · {section.source}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
      </div>
    </section>
  );
}

function ProjectHeader({
  project,
  busy,
  onSave
}: {
  project: Project;
  busy: boolean;
  onSave: (project: Partial<Project>) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="project-header">
      <div className="project-title-block">
        <span className={`status-pill ${project.status}`}>{statusLabels[project.status]}</span>
        <h1>{project.name}</h1>
        <p>{project.summary || "요약 없음"}</p>
        <div className="project-meta">
          <span>{project.client || "고객 미지정"}</span>
          <span>{project.line || "라인 미지정"}</span>
          <span>{project.equipment || "장비 미지정"}</span>
          <span>업데이트 {formatDate(project.updatedAt)}</span>
        </div>
      </div>
      <div className="header-actions">
        <IconButton title="프로젝트 정보 수정" onClick={() => setEditing(true)}>
          <Pencil size={18} />
        </IconButton>
      </div>

      {editing && (
        <Modal title="프로젝트 정보" onClose={() => setEditing(false)}>
          <ProjectForm
            project={project}
            submitLabel="저장"
            busy={busy}
            onSubmit={(patch) => {
              onSave(patch);
              setEditing(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ProjectForm({
  project,
  submitLabel,
  busy,
  onSubmit
}: {
  project: Partial<Project>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (project: Partial<Project>) => void;
}) {
  const [draft, setDraft] = useState({
    name: project.name || "",
    client: project.client || "",
    line: project.line || "",
    equipment: project.equipment || "",
    status: project.status || "planning",
    summary: project.summary || "",
    tags: project.tags?.join(", ") || ""
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      ...draft,
      status: draft.status as ProjectStatus,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    });
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="프로젝트명">
        <input
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label="상태">
        <select
          value={draft.status}
          onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatus })}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="고객">
        <input value={draft.client} onChange={(event) => setDraft({ ...draft, client: event.target.value })} />
      </Field>
      <Field label="라인">
        <input value={draft.line} onChange={(event) => setDraft({ ...draft, line: event.target.value })} />
      </Field>
      <Field label="장비">
        <input
          value={draft.equipment}
          onChange={(event) => setDraft({ ...draft, equipment: event.target.value })}
        />
      </Field>
      <Field label="태그">
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
      </Field>
      <Field label="요약" wide>
        <textarea
          value={draft.summary}
          onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
        />
      </Field>
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          <Save size={18} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function SectionPanel({
  projectId,
  section,
  password,
  busy,
  onBusyChange,
  onError,
  onNotice,
  onSectionSave,
  onSectionDelete,
  onProjectRefresh
}: {
  projectId: string;
  section: SectionDefinition;
  password: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onSectionSave: (patch: Partial<SectionDefinition>) => void;
  onSectionDelete: () => void;
  onProjectRefresh: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<SectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function loadItems() {
    setLoading(true);
    setSectionError("");
    try {
      setItems(await api.getItems(projectId, section.id));
    } catch (err) {
      setSectionError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, [projectId, section.id, section.updatedAt]);

  async function mutateItem(task: () => Promise<void>, message: string) {
    onBusyChange(true);
    onError("");
    onNotice("");
    try {
      await task();
      await loadItems();
      await onProjectRefresh();
      onNotice(message);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  async function syncNotionCache() {
    onBusyChange(true);
    onError("");
    onNotice("");
    setSectionError("");
    try {
      const syncedItems = await api.syncSection(password, projectId, section.id);
      setItems(syncedItems);
      await onProjectRefresh();
      onNotice("Notion 이력 캐시를 동기화했습니다.");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <div className="section-kicker">
            {sectionIcon(section)}
            <span>{sectionTypeLabels[section.type]}</span>
            <span>{section.source === "notion" ? "Notion 원본" : "로컬 원본"}</span>
          </div>
          <h3>{section.title}</h3>
          {section.description && <p>{section.description}</p>}
        </div>
        <div className="section-actions">
          <IconButton title="섹션 새로고침" onClick={() => void loadItems()}>
            <RefreshCw size={17} />
          </IconButton>
          {section.type === "nodeHistory" && section.source === "notion" && (
            <IconButton title="Notion 이력 캐시 동기화" onClick={() => void syncNotionCache()}>
              <Database size={17} />
            </IconButton>
          )}
          <IconButton title="섹션 설정" onClick={() => setSettingsOpen(true)}>
            <Settings size={17} />
          </IconButton>
          <IconButton
            title="섹션 삭제"
            onClick={() => {
              if (window.confirm(`'${section.title}' 섹션과 그 안의 항목을 모두 삭제할까요?`)) {
                onSectionDelete();
              }
            }}
          >
            <Trash2 size={17} />
          </IconButton>
        </div>
      </div>

      {sectionError && <InlineError text={sectionError} />}
      {loading ? (
        <StateLine icon={<Loader2 className="spin" size={16} />} text="섹션 데이터 로딩" />
      ) : section.type === "nodeHistory" ? (
        <NodeHistoryView
          items={items as HistoryNode[]}
          busy={busy}
          readOnly={section.source === "notion"}
          onAdd={(item) =>
            mutateItem(
              () => api.createItem(password, projectId, section.id, item).then(() => undefined),
              "이력 노드가 추가되었습니다."
            )
          }
          onSave={(itemId, item) =>
            mutateItem(
              () => api.updateItem(password, projectId, section.id, itemId, item).then(() => undefined),
              "이력 노드가 저장되었습니다."
            )
          }
          onDelete={(itemId) =>
            mutateItem(
              () => api.deleteItem(password, projectId, section.id, itemId).then(() => undefined),
              "이력 노드가 삭제되었습니다."
            )
          }
        />
      ) : section.type === "table" ? (
        <TableSectionView
          section={section}
          items={items as TableRow[]}
          busy={busy}
          onAdd={(values) =>
            mutateItem(
              () =>
                api
                  .createItem(password, projectId, section.id, { values })
                  .then(() => undefined),
              "테이블 행이 추가되었습니다."
            )
          }
          onSave={(itemId, values) =>
            mutateItem(
              () =>
                api
                  .updateItem(password, projectId, section.id, itemId, { values })
                  .then(() => undefined),
              "테이블 행이 저장되었습니다."
            )
          }
          onDelete={(itemId) =>
            mutateItem(
              () => api.deleteItem(password, projectId, section.id, itemId).then(() => undefined),
              "테이블 행이 삭제되었습니다."
            )
          }
        />
      ) : (
        <LinkBoardView
          items={items as LinkItem[]}
          busy={busy}
          onAdd={(item) =>
            mutateItem(
              () => api.createItem(password, projectId, section.id, item).then(() => undefined),
              "링크가 추가되었습니다."
            )
          }
          onDelete={(itemId) =>
            mutateItem(
              () => api.deleteItem(password, projectId, section.id, itemId).then(() => undefined),
              "링크가 삭제되었습니다."
            )
          }
        />
      )}

      {settingsOpen && (
        <Modal title="섹션 설정" onClose={() => setSettingsOpen(false)}>
          <SectionForm
            section={section}
            submitLabel="저장"
            busy={busy}
            password={password}
            onSubmit={(patch) => {
              onSectionSave(patch);
              setSettingsOpen(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function NodeHistoryView({
  items,
  busy,
  readOnly,
  onAdd,
  onSave,
  onDelete
}: {
  items: HistoryNode[];
  busy: boolean;
  readOnly: boolean;
  onAdd: (item: Record<string, unknown>) => void;
  onSave: (itemId: string, item: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [insertTarget, setInsertTarget] = useState<{
    itemId: string;
    position: "before" | "after";
  } | null>(null);
  const [editingItemId, setEditingItemId] = useState("");
  const latest = items[0];
  const past = items.slice(1);

  function submitInsert(item: Record<string, unknown>) {
    if (!insertTarget) {
      onAdd(item);
      return;
    }

    onAdd({
      ...item,
      ...(insertTarget.position === "before"
        ? { insertBeforeId: insertTarget.itemId }
        : { insertAfterId: insertTarget.itemId })
    });
    setInsertTarget(null);
    setShowPast(true);
  }

  function renderNode(item: HistoryNode, latestNode = false) {
    return (
      <div key={item.id} className="history-node-slot">
        {insertTarget?.itemId === item.id && insertTarget.position === "before" && (
          <NodeForm
            busy={busy}
            submitLabel="위에 삽입"
            onSubmit={submitInsert}
            onCancel={() => setInsertTarget(null)}
          />
        )}
        <HistoryNodeItem
          item={item}
          latest={latestNode}
          readOnly={readOnly}
          onEdit={() => setEditingItemId(item.id)}
          onInsertBefore={() => setInsertTarget({ itemId: item.id, position: "before" })}
          onInsertAfter={() => {
            setInsertTarget({ itemId: item.id, position: "after" });
            if (!latestNode) {
              setShowPast(true);
            }
          }}
          onDelete={() => {
            if (window.confirm(`'${item.title}' 노드를 삭제할까요?`)) {
              onDelete(item.id);
            }
          }}
        />
        {editingItemId === item.id && (
          <NodeForm
            busy={busy}
            initialItem={item}
            submitLabel="수정 저장"
            onSubmit={(patch) => {
              onSave(item.id, patch);
              setEditingItemId("");
            }}
            onCancel={() => setEditingItemId("")}
          />
        )}
        {insertTarget?.itemId === item.id && insertTarget.position === "after" && (
          <NodeForm
            busy={busy}
            submitLabel="아래에 삽입"
            onSubmit={submitInsert}
            onCancel={() => setInsertTarget(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="node-history">
      <div className="content-actions">
        {readOnly && <span className="readonly-note">Notion 원본은 동기화로 캐시를 갱신합니다.</span>}
        {past.length > 0 && (
          <button className="ghost-button" type="button" onClick={() => setShowPast(!showPast)}>
            {showPast ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            과거 이력 {past.length}
          </button>
        )}
        {!readOnly && (
          <button className="primary-button" type="button" onClick={() => setFormOpen(!formOpen)}>
            <Plus size={17} />
            노드 추가
          </button>
        )}
      </div>

      {!readOnly && formOpen && (
        <NodeForm
          busy={busy}
          submitLabel="최신 노드 추가"
          onSubmit={(item) => {
            onAdd(item);
            setFormOpen(false);
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {latest ? (
        renderNode(latest, true)
      ) : (
        <BlankLine text={readOnly ? "동기화된 Notion 이력 캐시가 없습니다." : "등록된 이력 노드가 없습니다."} />
      )}

      {showPast && (
        <div className="node-chain">
          {past.map((item) => renderNode(item))}
        </div>
      )}
    </div>
  );
}

function HistoryNodeItem({
  item,
  latest,
  readOnly,
  onEdit,
  onInsertBefore,
  onInsertAfter,
  onDelete
}: {
  item: HistoryNode;
  latest?: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(Boolean(latest));

  return (
    <article className={`history-node ${latest ? "latest" : ""}`}>
      <div className="node-summary">
        <button className="node-toggle" type="button" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>
            <strong>{item.title}</strong>
            <small>{item.date} {item.author ? `· ${item.author}` : ""}</small>
          </span>
        </button>
        {latest && <span className="latest-badge">최신</span>}
        {!readOnly && (
          <div className="node-inline-actions">
            <button type="button" onClick={onEdit}>
              <Pencil size={14} />
              수정
            </button>
            <button type="button" onClick={onInsertBefore}>위에 삽입</button>
            <button type="button" onClick={onInsertAfter}>아래 삽입</button>
            <button type="button" className="danger-action" onClick={onDelete}>
              <Trash2 size={14} />
              삭제
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="node-body">
          <p>{item.summary}</p>
          {item.body && <pre>{item.body}</pre>}
          {item.notionUrl && (
            <a href={item.notionUrl} target="_blank" rel="noreferrer" className="inline-link">
              <ExternalLink size={15} />
              Notion
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function NodeForm({
  busy,
  initialItem,
  submitLabel = "추가",
  onSubmit,
  onCancel
}: {
  busy: boolean;
  initialItem?: HistoryNode;
  submitLabel?: string;
  onSubmit: (item: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState({
    title: initialItem?.title || "",
    date: initialItem?.date || new Date().toISOString().slice(0, 10),
    summary: initialItem?.summary || "",
    body: initialItem?.body || "",
    author: initialItem?.author || "",
    notionUrl: initialItem?.notionUrl || ""
  });

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
        if (!initialItem) {
          setDraft({ ...draft, title: "", summary: "", body: "", notionUrl: "" });
        }
      }}
    >
      <input
        required
        placeholder="제목"
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <input
        type="date"
        value={draft.date}
        onChange={(event) => setDraft({ ...draft, date: event.target.value })}
      />
      <input
        placeholder="작성자"
        value={draft.author}
        onChange={(event) => setDraft({ ...draft, author: event.target.value })}
      />
      <input
        placeholder="Notion URL"
        value={draft.notionUrl}
        onChange={(event) => setDraft({ ...draft, notionUrl: event.target.value })}
      />
      <textarea
        className="wide-input"
        required
        placeholder="요약"
        value={draft.summary}
        onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
      />
      <textarea
        className="wide-input"
        placeholder="상세"
        value={draft.body}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
      />
      <button className="primary-button" type="submit" disabled={busy}>
        <Save size={17} />
        {submitLabel}
      </button>
      {onCancel && (
        <button className="ghost-button" type="button" onClick={onCancel}>
          취소
        </button>
      )}
    </form>
  );
}

function TableSectionView({
  section,
  items,
  busy,
  onAdd,
  onSave,
  onDelete
}: {
  section: SectionDefinition;
  items: TableRow[];
  busy: boolean;
  onAdd: (values: Record<string, unknown>) => void;
  onSave: (itemId: string, values: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const columns = section.columns?.length ? section.columns : defaultTableColumns;
  const [formOpen, setFormOpen] = useState(false);
  const [newValues, setNewValues] = useState<Record<string, unknown>>({});
  const [draftRows, setDraftRows] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    const next: Record<string, Record<string, unknown>> = {};
    for (const row of items) {
      next[row.id] = { ...row.values };
    }
    setDraftRows(next);
  }, [items]);

  return (
    <div className="table-section">
      <div className="content-actions">
        <button className="primary-button" type="button" onClick={() => setFormOpen(!formOpen)}>
          <Plus size={17} />
          행 추가
        </button>
      </div>

      {formOpen && (
        <form
          className="inline-form table-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(newValues);
            setNewValues({});
          }}
        >
          {columns.map((column) => (
            <label key={column.id}>
              <span>{column.label}</span>
              <CellInput
                column={column}
                value={newValues[column.id]}
                onChange={(value) => setNewValues({ ...newValues, [column.id]: value })}
              />
            </label>
          ))}
          <button className="primary-button" type="submit" disabled={busy}>
            <Save size={17} />
            추가
          </button>
        </form>
      )}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id}>{column.label}</th>
              ))}
              <th>링크</th>
              <th>저장</th>
              <th>삭제</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 3}>
                  <BlankLine text="등록된 행이 없습니다." />
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.id}>
                      <CellInput
                        column={column}
                        value={draftRows[row.id]?.[column.id]}
                        onChange={(value) =>
                          setDraftRows({
                            ...draftRows,
                            [row.id]: {
                              ...(draftRows[row.id] || {}),
                              [column.id]: value
                            }
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    {row.notionUrl ? (
                      <a href={row.notionUrl} target="_blank" rel="noreferrer" className="icon-link">
                        <ExternalLink size={16} />
                      </a>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>
                    <IconButton title="행 저장" onClick={() => onSave(row.id, draftRows[row.id] || {})}>
                      <Check size={17} />
                    </IconButton>
                  </td>
                  <td>
                    <IconButton
                      title="행 삭제"
                      onClick={() => {
                        if (window.confirm("이 행을 삭제할까요?")) {
                          onDelete(row.id);
                        }
                      }}
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellInput({
  column,
  value,
  onChange
}: {
  column: TableColumn;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (column.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (column.type === "date") {
    return (
      <input
        type="date"
        value={String(value || "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (column.type === "number") {
    return (
      <input
        type="number"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (column.type === "url") {
    return (
      <input
        type="url"
        value={String(value || "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      value={String(value || "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function LinkBoardView({
  items,
  busy,
  onAdd,
  onDelete
}: {
  items: LinkItem[];
  busy: boolean;
  onAdd: (item: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    url: "",
    kind: "notion" as LinkKind,
    description: ""
  });

  return (
    <div className="link-board">
      <div className="content-actions">
        <button className="primary-button" type="button" onClick={() => setFormOpen(!formOpen)}>
          <Plus size={17} />
          링크 추가
        </button>
      </div>

      {formOpen && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(draft);
            setDraft({ title: "", url: "", kind: "notion", description: "" });
          }}
        >
          <input
            required
            placeholder="제목"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <input
            required
            type="url"
            placeholder="URL"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
          />
          <select
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value as LinkKind })}
          >
            {["notion", "file", "diagram", "sheet", "repo", "other"].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            placeholder="설명"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <button className="primary-button" type="submit" disabled={busy}>
            <Save size={17} />
            추가
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <BlankLine text="등록된 링크가 없습니다." />
      ) : (
        <div className="link-grid">
          {items.map((item) => (
            <div key={item.id} className="link-item-shell">
              <a className="link-item" href={item.url} target="_blank" rel="noreferrer">
                <span>{linkIcon(item.kind)}</span>
                <strong>{item.title}</strong>
                <small>{item.description || item.kind}</small>
                <ExternalLink size={16} />
              </a>
              <IconButton
                title="링크 삭제"
                onClick={() => {
                  if (window.confirm(`'${item.title}' 링크를 삭제할까요?`)) {
                    onDelete(item.id);
                  }
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionForm({
  section,
  submitLabel,
  busy,
  password,
  onSubmit
}: {
  section: Partial<SectionDefinition>;
  submitLabel: string;
  busy: boolean;
  password: string;
  onSubmit: (section: Partial<SectionDefinition>) => void;
}) {
  const [draft, setDraft] = useState({
    title: section.title || "",
    description: section.description || "",
    type: section.type || "nodeHistory",
    source: section.source || "local",
    order: section.order || 1,
    dataSourceId: section.notion?.dataSourceId || "",
    pageSize: section.notion?.pageSize || 50,
    sortProperty: section.notion?.sortProperty || "",
    sortDirection: section.notion?.sortDirection || "descending",
    historyTitleProperty: section.notion?.historyMapping?.title || "",
    historyDateProperty: section.notion?.historyMapping?.date || "",
    historySummaryProperty: section.notion?.historyMapping?.summary || "",
    historyBodyProperty: section.notion?.historyMapping?.body || "",
    historyAuthorProperty: section.notion?.historyMapping?.author || "",
    historyUrlProperty: section.notion?.historyMapping?.notionUrl || ""
  });
  const [columns, setColumns] = useState<TableColumn[]>(
    section.columns?.length ? section.columns : defaultTableColumns
  );
  const [filters, setFilters] = useState<NotionFilterRule[]>(section.notion?.filters || []);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState("");

  const type = draft.type as SectionType;
  const source = type === "linkBoard" ? "local" : (draft.source as SectionSource);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      title: draft.title,
      description: draft.description,
      type,
      source,
      order: Number(draft.order) || 1,
      columns: type === "table" ? columns : undefined,
      notion:
        type !== "linkBoard" && source === "notion"
          ? {
              dataSourceId: draft.dataSourceId,
              pageSize: Number(draft.pageSize) || 50,
              sortProperty: draft.sortProperty,
              sortDirection: draft.sortDirection as "ascending" | "descending",
              filters,
              ...(type === "nodeHistory"
                ? {
                    historyMapping: {
                      title: draft.historyTitleProperty,
                      date: draft.historyDateProperty,
                      summary: draft.historySummaryProperty,
                      body: draft.historyBodyProperty,
                      author: draft.historyAuthorProperty,
                      notionUrl: draft.historyUrlProperty
                    }
                  }
                : {})
            }
          : undefined
    });
  }

  async function loadNotionColumns() {
    setSchemaLoading(true);
    setSchemaError("");
    try {
      const schema = await api.getNotionSchema(password, draft.dataSourceId);
      setColumns(schema.columns);
      setFilters((current) =>
        current.map((filter) => {
          const column = schema.columns.find(
            (candidate) =>
              candidate.notionProperty === filter.property ||
              candidate.label === filter.property ||
              candidate.id === filter.property
          );
          return column ? { ...filter, property: column.notionProperty || column.label, type: column.notionType } : filter;
        })
      );
      setDraft({
        ...draft,
        dataSourceId: schema.dataSourceId,
        sortProperty: draft.sortProperty || schema.columns.find((column) => column.notionType === "title")?.notionProperty || ""
      });
    } catch (err) {
      setSchemaError((err as Error).message);
    } finally {
      setSchemaLoading(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="섹션명">
        <input
          required
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </Field>
      <Field label="타입">
        <select
          value={draft.type}
          onChange={(event) =>
            setDraft({
              ...draft,
              type: event.target.value as SectionType,
              source: event.target.value === "linkBoard" ? "local" : draft.source
            })
          }
        >
          {Object.entries(sectionTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="순서">
        <input
          type="number"
          value={draft.order}
          onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) })}
        />
      </Field>
      <Field label="원본">
        <select
          value={source}
          disabled={type === "linkBoard"}
          onChange={(event) => setDraft({ ...draft, source: event.target.value as SectionSource })}
        >
          <option value="local">local</option>
          <option value="notion">notion</option>
        </select>
      </Field>
      <Field label="설명" wide>
        <textarea
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </Field>

      {type === "table" && (
        <Field label="컬럼" wide>
          <ColumnEditor columns={columns} onChange={setColumns} notionEnabled={source === "notion"} />
        </Field>
      )}

      {type !== "linkBoard" && source === "notion" && (
        <>
          <Field label="Data Source ID" wide>
            <input
              required
              value={draft.dataSourceId}
              onChange={(event) => setDraft({ ...draft, dataSourceId: event.target.value })}
            />
          </Field>
          {type === "table" && (
            <Field label="Notion 컬럼" wide>
              <div className="schema-loader-row">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={schemaLoading || busy || !draft.dataSourceId.trim()}
                  onClick={() => void loadNotionColumns()}
                >
                  {schemaLoading ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                  컬럼 자동 불러오기
                </button>
                <span>{columns.length}개 컬럼</span>
              </div>
              {schemaError && <InlineError text={schemaError} />}
            </Field>
          )}
          <Field label="정렬 속성">
            <input
              value={draft.sortProperty}
              onChange={(event) => setDraft({ ...draft, sortProperty: event.target.value })}
            />
          </Field>
          <Field label="정렬 방향">
            <select
              value={draft.sortDirection}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  sortDirection: event.target.value as "ascending" | "descending"
                })
              }
            >
              <option value="descending">descending</option>
              <option value="ascending">ascending</option>
            </select>
          </Field>
          <Field label="필터" wide>
            <NotionFilterEditor
              filters={filters}
              columns={columns}
              onChange={setFilters}
            />
          </Field>
        </>
      )}

      {type === "nodeHistory" && source === "notion" && (
        <>
          <Field label="제목 속성">
            <input
              placeholder="비우면 title 속성 자동 사용"
              value={draft.historyTitleProperty}
              onChange={(event) => setDraft({ ...draft, historyTitleProperty: event.target.value })}
            />
          </Field>
          <Field label="날짜 속성">
            <input
              placeholder="예: Date"
              value={draft.historyDateProperty}
              onChange={(event) => setDraft({ ...draft, historyDateProperty: event.target.value })}
            />
          </Field>
          <Field label="요약 속성">
            <input
              placeholder="예: Summary"
              value={draft.historySummaryProperty}
              onChange={(event) => setDraft({ ...draft, historySummaryProperty: event.target.value })}
            />
          </Field>
          <Field label="상세 속성">
            <input
              placeholder="예: Body"
              value={draft.historyBodyProperty}
              onChange={(event) => setDraft({ ...draft, historyBodyProperty: event.target.value })}
            />
          </Field>
          <Field label="작성자 속성">
            <input
              placeholder="예: Author"
              value={draft.historyAuthorProperty}
              onChange={(event) => setDraft({ ...draft, historyAuthorProperty: event.target.value })}
            />
          </Field>
          <Field label="URL 속성">
            <input
              placeholder="비우면 페이지 URL 사용"
              value={draft.historyUrlProperty}
              onChange={(event) => setDraft({ ...draft, historyUrlProperty: event.target.value })}
            />
          </Field>
        </>
      )}

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          <Save size={18} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function ColumnEditor({
  columns,
  notionEnabled,
  onChange
}: {
  columns: TableColumn[];
  notionEnabled: boolean;
  onChange: (columns: TableColumn[]) => void;
}) {
  function update(index: number, patch: Partial<TableColumn>) {
    onChange(columns.map((column, columnIndex) => (columnIndex === index ? { ...column, ...patch } : column)));
  }

  function addColumn() {
    onChange([
      ...columns,
      {
        id: `col${columns.length + 1}`,
        label: "새 컬럼",
        type: "text",
        notionType: "rich_text",
        notionProperty: ""
      }
    ]);
  }

  return (
    <div className="column-editor">
      {columns.map((column, index) => (
        <div className="column-row" key={`${column.id}-${index}`}>
          <input
            value={column.id}
            onChange={(event) => update(index, { id: event.target.value })}
            placeholder="id"
          />
          <input
            value={column.label}
            onChange={(event) => update(index, { label: event.target.value })}
            placeholder="라벨"
          />
          <select
            value={column.type}
            onChange={(event) => update(index, { type: event.target.value as TableColumnType })}
          >
            {Object.entries(columnTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {notionEnabled && (
            <>
              <input
                value={column.notionProperty || ""}
                onChange={(event) => update(index, { notionProperty: event.target.value })}
                placeholder="Notion 속성명"
              />
              <select
                value={column.notionType || "rich_text"}
                onChange={(event) => update(index, { notionType: event.target.value as NotionPropertyType })}
              >
                {notionTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <label className="compact-check">
                <input
                  type="checkbox"
                  checked={Boolean(column.readOnly)}
                  onChange={(event) => update(index, { readOnly: event.target.checked })}
                />
                읽기전용
              </label>
            </>
          )}
          <IconButton title="컬럼 삭제" onClick={() => onChange(columns.filter((_, columnIndex) => columnIndex !== index))}>
            <X size={16} />
          </IconButton>
        </div>
      ))}
      <button className="ghost-button" type="button" onClick={addColumn}>
        <Plus size={16} />
        컬럼 추가
      </button>
    </div>
  );
}

function NotionFilterEditor({
  filters,
  columns,
  onChange
}: {
  filters: NotionFilterRule[];
  columns: TableColumn[];
  onChange: (filters: NotionFilterRule[]) => void;
}) {
  function update(index: number, patch: Partial<NotionFilterRule>) {
    onChange(filters.map((filter, filterIndex) => (filterIndex === index ? { ...filter, ...patch } : filter)));
  }

  function addFilter() {
    const firstColumn = columns[0];
    onChange([
      ...filters,
      {
        id: `filter-${Date.now()}`,
        property: firstColumn?.notionProperty || firstColumn?.label || "",
        type: firstColumn?.notionType || "rich_text",
        operator: "equals",
        value: ""
      }
    ]);
  }

  function updateProperty(index: number, property: string) {
    const column = columns.find(
      (candidate) =>
        candidate.notionProperty === property ||
        candidate.label === property ||
        candidate.id === property
    );
    update(index, {
      property,
      ...(column?.notionType ? { type: column.notionType } : {})
    });
  }

  return (
    <div className="filter-editor">
      {filters.length === 0 && <span className="muted">필터 없음</span>}
      {filters.map((filter, index) => {
        const hideValue = filter.operator === "is_empty" || filter.operator === "is_not_empty";
        return (
          <div className="filter-row" key={filter.id || index}>
            <input
              list="notion-filter-properties"
              value={filter.property}
              placeholder="Notion 속성명"
              onChange={(event) => updateProperty(index, event.target.value)}
            />
            <select
              value={filter.type || "rich_text"}
              onChange={(event) => update(index, { type: event.target.value as NotionPropertyType })}
            >
              {notionTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={filter.operator}
              onChange={(event) => update(index, { operator: event.target.value as NotionFilterOperator })}
            >
              {notionFilterOperators.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
            <input
              value={filter.value || ""}
              placeholder={filterPlaceholder(filter.type)}
              disabled={hideValue}
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <IconButton title="필터 삭제" onClick={() => onChange(filters.filter((_, filterIndex) => filterIndex !== index))}>
              <X size={16} />
            </IconButton>
          </div>
        );
      })}
      <datalist id="notion-filter-properties">
        {columns.map((column) => (
          <option key={column.id} value={column.notionProperty || column.label}>
            {column.label}
          </option>
        ))}
      </datalist>
      <button className="ghost-button" type="button" onClick={addFilter}>
        <Plus size={16} />
        필터 추가
      </button>
    </div>
  );
}

function filterPlaceholder(type?: NotionPropertyType): string {
  if (type === "checkbox") return "true 또는 false";
  if (type === "number") return "숫자";
  if (type === "date" || type === "created_time" || type === "last_edited_time") return "YYYY-MM-DD";
  if (type === "multi_select") return "옵션명";
  return "값";
}

function Field({
  label,
  wide,
  children
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <IconButton title="닫기" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function IconButton({
  title,
  children,
  onClick
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="icon-button" type="button" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

function Banner({ tone, text }: { tone: "error" | "success"; text: string }) {
  return (
    <div className={`banner ${tone}`}>
      {tone === "error" ? <AlertCircle size={18} /> : <Check size={18} />}
      <span>{text}</span>
    </div>
  );
}

function InlineError({ text }: { text: string }) {
  return (
    <div className="inline-error">
      <AlertCircle size={16} />
      <span>{text}</span>
    </div>
  );
}

function StateLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="state-line">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function BlankLine({ text }: { text: string }) {
  return <div className="blank-line">{text}</div>;
}

function EmptyState() {
  return (
    <div className="empty-state">
      <FileText size={34} />
      <h1>프로젝트가 없습니다.</h1>
    </div>
  );
}

function sectionIcon(section: SectionDefinition) {
  if (section.type === "nodeHistory") return <History size={16} />;
  if (section.type === "table") return section.source === "notion" ? <Database size={16} /> : <Table2 size={16} />;
  return <Link2 size={16} />;
}

function linkIcon(kind: LinkKind) {
  if (kind === "notion") return <FileText size={18} />;
  if (kind === "diagram") return <PanelLeft size={18} />;
  if (kind === "sheet") return <Table2 size={18} />;
  return <Link2 size={18} />;
}

function compactMeta(project: Project): string {
  return [project.client, project.line, project.equipment].filter(Boolean).join(" · ") || "정보 없음";
}

function formatDate(value: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function canvasHistoryModalTitle(target?: { position: "before" | "after" }): string {
  if (target?.position === "before") return "위에 이력 노드 삽입";
  if (target?.position === "after") return "아래에 이력 노드 삽입";
  return "최신 이력 노드 추가";
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }

    return value === "true";
  } catch {
    return fallback;
  }
}

export default App;
