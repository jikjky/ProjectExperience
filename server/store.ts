import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  HistoryNode,
  LinkItem,
  CanvasLayout,
  CanvasLayoutState,
  CanvasViewport,
  Project,
  ProjectsFile,
  SectionDefinition,
  SectionItem,
  TableColumn,
  TableRow
} from "../shared/types.js";

const dataFile = path.join(process.cwd(), "data", "projects.json");
const canvasLayoutFile = path.join(process.cwd(), "data", "canvas-layout.json");

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function readProjectsFile(): Promise<ProjectsFile> {
  try {
    const raw = await readFile(dataFile, "utf-8");
    return JSON.parse(raw) as ProjectsFile;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }

    const initial: ProjectsFile = { projects: [] };
    await writeProjectsFile(initial);
    return initial;
  }
}

export async function writeProjectsFile(data: ProjectsFile): Promise<void> {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const tempFile = `${dataFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  await rename(tempFile, dataFile);
}

export async function readCanvasLayoutFile(): Promise<CanvasLayoutState> {
  try {
    const raw = await readFile(canvasLayoutFile, "utf-8");
    return normalizeCanvasLayoutState(JSON.parse(raw));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }

    await writeCanvasLayoutFile({ nodes: {} });
    return { nodes: {} };
  }
}

export async function writeCanvasLayoutFile(layout: unknown): Promise<CanvasLayoutState> {
  const normalized = normalizeCanvasLayoutState(layout);
  await mkdir(path.dirname(canvasLayoutFile), { recursive: true });
  const tempFile = `${canvasLayoutFile}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  await rename(tempFile, canvasLayoutFile);
  return normalized;
}

async function pruneCanvasLayoutForSection(sectionId: string): Promise<void> {
  const layout = await readCanvasLayoutFile();
  const nextNodes: CanvasLayout = {};
  for (const [nodeId, nodeLayout] of Object.entries(layout.nodes)) {
    if (nodeId === `section:${sectionId}` || nodeId.startsWith(`history:${sectionId}:`)) {
      continue;
    }

    nextNodes[nodeId] = nodeLayout;
  }

  await writeCanvasLayoutFile({
    nodes: nextNodes,
    ...(layout.viewport ? { viewport: layout.viewport } : {})
  });
}

export async function listProjects(): Promise<Project[]> {
  const data = await readProjectsFile();
  return sortProjects(data.projects);
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const data = await readProjectsFile();
  return data.projects.find((project) => project.id === projectId);
}

export async function createProject(input: Partial<Project>): Promise<Project> {
  const data = await readProjectsFile();
  const timestamp = nowIso();
  const project: Project = {
    id: input.id || newId("project"),
    name: String(input.name || "새 프로젝트"),
    client: input.client || "",
    line: input.line || "",
    equipment: input.equipment || "",
    status: input.status || "planning",
    summary: input.summary || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    sections: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  data.projects.push(project);
  await writeProjectsFile(data);
  return project;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Project>
): Promise<Project | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return undefined;
  }

  project.name = patch.name ?? project.name;
  project.client = patch.client ?? project.client;
  project.line = patch.line ?? project.line;
  project.equipment = patch.equipment ?? project.equipment;
  project.status = patch.status ?? project.status;
  project.summary = patch.summary ?? project.summary;
  project.tags = Array.isArray(patch.tags) ? patch.tags : project.tags;
  project.updatedAt = nowIso();

  await writeProjectsFile(data);
  return project;
}

export async function createSection(
  projectId: string,
  input: Partial<SectionDefinition>
): Promise<SectionDefinition | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return undefined;
  }

  const timestamp = nowIso();
  const section: SectionDefinition = {
    id: input.id || newId("section"),
    title: String(input.title || "새 섹션"),
    description: input.description || "",
    type: input.type || "nodeHistory",
    source: input.source || "local",
    order: Number.isFinite(input.order) ? Number(input.order) : project.sections.length + 1,
    columns: normalizeColumns(input.columns),
    notion: input.notion,
    items: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  if (section.type === "linkBoard") {
    section.source = "local";
    section.columns = undefined;
    section.notion = undefined;
  }

  if (section.type === "nodeHistory") {
    section.columns = undefined;
  }

  if (section.source !== "notion") {
    section.notion = undefined;
  }

  if (section.type === "table" && !section.columns?.length) {
    section.columns = defaultColumns();
  }

  project.sections.push(section);
  project.updatedAt = timestamp;
  await writeProjectsFile(data);
  return section;
}

export async function updateSection(
  projectId: string,
  sectionId: string,
  patch: Partial<SectionDefinition>
): Promise<SectionDefinition | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const section = project?.sections.find((candidate) => candidate.id === sectionId);
  if (!project || !section) {
    return undefined;
  }

  section.title = patch.title ?? section.title;
  section.description = patch.description ?? section.description;
  section.type = patch.type ?? section.type;
  section.source = patch.source ?? section.source;
  section.order = Number.isFinite(patch.order) ? Number(patch.order) : section.order;
  section.columns = patch.columns ? normalizeColumns(patch.columns) : section.columns;
  section.notion = patch.notion ?? section.notion;

  if (section.type === "linkBoard") {
    section.source = "local";
    section.columns = undefined;
    section.notion = undefined;
  }

  if (section.type === "nodeHistory") {
    section.columns = undefined;
  }

  if (section.source !== "notion") {
    section.notion = undefined;
  }

  section.updatedAt = nowIso();
  project.updatedAt = section.updatedAt;
  await writeProjectsFile(data);
  return section;
}

export async function deleteSection(projectId: string, sectionId: string): Promise<boolean> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return false;
  }

  const index = project.sections.findIndex((candidate) => candidate.id === sectionId);
  if (index < 0) {
    return false;
  }

  const timestamp = nowIso();
  project.sections.splice(index, 1);
  project.updatedAt = timestamp;
  await writeProjectsFile(data);
  await pruneCanvasLayoutForSection(sectionId);
  return true;
}

export async function getLocalItems(
  projectId: string,
  sectionId: string
): Promise<SectionItem[] | undefined> {
  const section = await getSection(projectId, sectionId);
  return section?.items;
}

export async function addLocalItem(
  projectId: string,
  sectionId: string,
  input: Record<string, unknown>
): Promise<SectionItem | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const section = project?.sections.find((candidate) => candidate.id === sectionId);
  if (!project || !section) {
    return undefined;
  }

  const item = buildItem(section, input);
  const insertIndex = resolveInsertIndex(section.items, input);
  section.items.splice(insertIndex, 0, item);
  section.updatedAt = nowIso();
  project.updatedAt = section.updatedAt;
  await writeProjectsFile(data);
  return item;
}

export async function updateLocalItem(
  projectId: string,
  sectionId: string,
  itemId: string,
  input: Record<string, unknown>
): Promise<SectionItem | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const section = project?.sections.find((candidate) => candidate.id === sectionId);
  if (!project || !section) {
    return undefined;
  }

  const index = section.items.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) {
    return undefined;
  }

  const timestamp = nowIso();
  const current = section.items[index];
  if (section.type === "nodeHistory") {
    section.items[index] = {
      ...(current as HistoryNode),
      ...input,
      id: current.id,
      links: Array.isArray(input.links) ? (input.links as LinkItem[]) : (current as HistoryNode).links,
      updatedAt: timestamp
    } as HistoryNode;
  } else if (section.type === "table") {
    section.items[index] = {
      ...(current as TableRow),
      values: {
        ...(current as TableRow).values,
        ...((input.values as Record<string, unknown>) || input)
      },
      updatedAt: timestamp
    } as TableRow;
  } else {
    section.items[index] = {
      ...(current as LinkItem),
      ...input,
      id: current.id,
      updatedAt: timestamp
    } as LinkItem;
  }

  section.updatedAt = timestamp;
  project.updatedAt = timestamp;
  await writeProjectsFile(data);
  return section.items[index];
}

export async function deleteLocalItem(
  projectId: string,
  sectionId: string,
  itemId: string
): Promise<boolean> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const section = project?.sections.find((candidate) => candidate.id === sectionId);
  if (!project || !section) {
    return false;
  }

  const index = section.items.findIndex((candidate) => candidate.id === itemId);
  if (index < 0) {
    return false;
  }

  const timestamp = nowIso();
  section.items.splice(index, 1);
  section.updatedAt = timestamp;
  project.updatedAt = timestamp;
  await writeProjectsFile(data);
  return true;
}

export async function replaceLocalItems(
  projectId: string,
  sectionId: string,
  items: SectionItem[]
): Promise<SectionItem[] | undefined> {
  const data = await readProjectsFile();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const section = project?.sections.find((candidate) => candidate.id === sectionId);
  if (!project || !section) {
    return undefined;
  }

  const timestamp = nowIso();
  section.items = items;
  section.updatedAt = timestamp;
  project.updatedAt = timestamp;
  await writeProjectsFile(data);
  return section.items;
}

export async function getSection(
  projectId: string,
  sectionId: string
): Promise<SectionDefinition | undefined> {
  const project = await getProject(projectId);
  return project?.sections.find((section) => section.id === sectionId);
}

function buildItem(section: SectionDefinition, input: Record<string, unknown>): SectionItem {
  const timestamp = nowIso();
  if (section.type === "nodeHistory") {
    return {
      id: newId("node"),
      title: String(input.title || "새 이력"),
      date: String(input.date || timestamp.slice(0, 10)),
      summary: String(input.summary || ""),
      body: String(input.body || ""),
      author: String(input.author || ""),
      notionUrl: String(input.notionUrl || ""),
      links: Array.isArray(input.links) ? (input.links as LinkItem[]) : [],
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies HistoryNode;
  }

  if (section.type === "table") {
    return {
      id: newId("row"),
      values: ((input.values as Record<string, unknown>) || input) ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies TableRow;
  }

  return {
    id: newId("link"),
    title: String(input.title || "새 링크"),
    url: String(input.url || ""),
    kind: (input.kind as LinkItem["kind"]) || "other",
    description: String(input.description || ""),
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies LinkItem;
}

function resolveInsertIndex(items: SectionItem[], input: Record<string, unknown>): number {
  const insertBeforeId = typeof input.insertBeforeId === "string" ? input.insertBeforeId : "";
  const insertAfterId = typeof input.insertAfterId === "string" ? input.insertAfterId : "";

  if (insertBeforeId) {
    const index = items.findIndex((item) => item.id === insertBeforeId);
    if (index >= 0) {
      return index;
    }
  }

  if (insertAfterId) {
    const index = items.findIndex((item) => item.id === insertAfterId);
    if (index >= 0) {
      return index + 1;
    }
  }

  return 0;
}

function normalizeColumns(columns: unknown): TableColumn[] | undefined {
  if (!Array.isArray(columns)) {
    return undefined;
  }

  return columns
    .filter((column) => column && typeof column === "object")
    .map((column) => {
      const value = column as Partial<TableColumn>;
      return {
        id: value.id || newId("col"),
        label: value.label || value.id || "컬럼",
        type: value.type || "text",
        required: Boolean(value.required),
        notionProperty: value.notionProperty || "",
        notionType: value.notionType || "rich_text"
      };
    });
}

function defaultColumns(): TableColumn[] {
  return [
    { id: "title", label: "제목", type: "text", required: true, notionType: "title" },
    { id: "status", label: "상태", type: "status", notionType: "status" },
    { id: "date", label: "날짜", type: "date", notionType: "date" },
    { id: "link", label: "링크", type: "url", notionType: "url" }
  ];
}

function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeCanvasLayoutState(input: unknown): CanvasLayoutState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { nodes: {} };
  }

  const candidate = input as Record<string, unknown>;
  const nodesSource = candidate.nodes && typeof candidate.nodes === "object" ? candidate.nodes : input;
  const viewport = normalizeCanvasViewport(candidate.viewport);

  return {
    nodes: normalizeCanvasLayout(nodesSource),
    ...(viewport ? { viewport } : {})
  };
}

function normalizeCanvasLayout(input: unknown): CanvasLayout {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const layout: CanvasLayout = {};
  for (const [nodeId, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const width = candidate.width === undefined ? undefined : Number(candidate.width);
    const height = candidate.height === undefined ? undefined : Number(candidate.height);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    layout[nodeId] = {
      x,
      y,
      ...(Number.isFinite(width) ? { width } : {}),
      ...(Number.isFinite(height) ? { height } : {})
    };
  }

  return layout;
}

function normalizeCanvasViewport(input: unknown): CanvasViewport | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const zoom = Number(candidate.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
    return undefined;
  }

  return { x, y, zoom };
}
