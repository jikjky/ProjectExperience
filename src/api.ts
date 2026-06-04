import type {
  CanvasLayoutState,
  NotionSchemaResponse,
  Project,
  SectionDefinition,
  SectionItem
} from "./types";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload.detail ? ` ${payload.detail}` : "";
    throw new Error(`${payload.error || "요청이 실패했습니다."}${detail}`);
  }

  return payload as T;
}

function editHeaders(password: string): HeadersInit {
  return {
    "x-edit-password": password
  };
}

export const api = {
  getCanvasLayout: () => requestJson<CanvasLayoutState>("/api/canvas-layout"),
  saveCanvasLayout: (layout: CanvasLayoutState) =>
    requestJson<CanvasLayoutState>("/api/canvas-layout", {
      method: "PUT",
      body: JSON.stringify(layout)
    }),
  listProjects: () => requestJson<Project[]>("/api/projects"),
  getProject: (projectId: string) => requestJson<Project>(`/api/projects/${projectId}`),
  createProject: (password: string, project: Partial<Project>) =>
    requestJson<Project>("/api/projects", {
      method: "POST",
      headers: editHeaders(password),
      body: JSON.stringify(project)
    }),
  updateProject: (password: string, projectId: string, project: Partial<Project>) =>
    requestJson<Project>(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: editHeaders(password),
      body: JSON.stringify(project)
    }),
  createSection: (password: string, projectId: string, section: Partial<SectionDefinition>) =>
    requestJson<SectionDefinition>(`/api/projects/${projectId}/sections`, {
      method: "POST",
      headers: editHeaders(password),
      body: JSON.stringify(section)
    }),
  updateSection: (
    password: string,
    projectId: string,
    sectionId: string,
    section: Partial<SectionDefinition>
  ) =>
    requestJson<SectionDefinition>(`/api/projects/${projectId}/sections/${sectionId}`, {
      method: "PUT",
      headers: editHeaders(password),
      body: JSON.stringify(section)
    }),
  deleteSection: (password: string, projectId: string, sectionId: string) =>
    requestJson<void>(`/api/projects/${projectId}/sections/${sectionId}`, {
      method: "DELETE",
      headers: editHeaders(password)
    }),
  getNotionSchema: (password: string, dataSourceId: string) =>
    requestJson<NotionSchemaResponse>("/api/notion/schema", {
      method: "POST",
      headers: editHeaders(password),
      body: JSON.stringify({ dataSourceId })
    }),
  getItems: (projectId: string, sectionId: string) =>
    requestJson<SectionItem[]>(`/api/projects/${projectId}/sections/${sectionId}/items`),
  syncSection: (password: string, projectId: string, sectionId: string) =>
    requestJson<SectionItem[]>(`/api/projects/${projectId}/sections/${sectionId}/sync`, {
      method: "POST",
      headers: editHeaders(password)
    }),
  createItem: (
    password: string,
    projectId: string,
    sectionId: string,
    item: Record<string, unknown>
  ) =>
    requestJson<SectionItem>(`/api/projects/${projectId}/sections/${sectionId}/items`, {
      method: "POST",
      headers: editHeaders(password),
      body: JSON.stringify(item)
    }),
  updateItem: (
    password: string,
    projectId: string,
    sectionId: string,
    itemId: string,
    item: Record<string, unknown>
  ) =>
    requestJson<SectionItem>(
      `/api/projects/${projectId}/sections/${sectionId}/items/${itemId}`,
      {
        method: "PUT",
        headers: editHeaders(password),
        body: JSON.stringify(item)
      }
    ),
  deleteItem: (password: string, projectId: string, sectionId: string, itemId: string) =>
    requestJson<void>(`/api/projects/${projectId}/sections/${sectionId}/items/${itemId}`, {
      method: "DELETE",
      headers: editHeaders(password)
    })
};
