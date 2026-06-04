import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import {
  addLocalItem,
  createProject,
  createSection,
  deleteLocalItem,
  deleteSection,
  readCanvasLayoutFile,
  getLocalItems,
  getProject,
  getSection,
  listProjects,
  replaceLocalItems,
  updateLocalItem,
  updateProject,
  updateSection,
  writeCanvasLayoutFile
} from "./store.js";
import {
  createNotionRow,
  archiveNotionRow,
  NotionIntegrationError,
  queryNotionHistoryNodes,
  queryNotionRows,
  retrieveNotionSchema,
  updateNotionRow
} from "./notion.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4173);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    notionConfigured: Boolean(process.env.NOTION_API_KEY),
    notionVersion: process.env.NOTION_VERSION || "2026-03-11"
  });
});

app.get("/api/canvas-layout", async (_request, response, next) => {
  try {
    response.json(await readCanvasLayoutFile());
  } catch (error) {
    next(error);
  }
});

app.put("/api/canvas-layout", async (request, response, next) => {
  try {
    response.json(await writeCanvasLayoutFile(request.body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects", async (_request, response, next) => {
  try {
    response.json(await listProjects());
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", async (request, response, next) => {
  try {
    const project = await getProject(param(request, "projectId"));
    if (!project) {
      response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
      return;
    }

    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", requireEditPassword, async (request, response, next) => {
  try {
    response.status(201).json(await createProject(request.body));
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId", requireEditPassword, async (request, response, next) => {
  try {
    const project = await updateProject(param(request, "projectId"), request.body);
    if (!project) {
      response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
      return;
    }

    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/projects/:projectId/sections",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const section = await createSection(param(request, "projectId"), request.body);
      if (!section) {
        response.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });
        return;
      }

      response.status(201).json(section);
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  "/api/projects/:projectId/sections/:sectionId",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const section = await updateSection(
        param(request, "projectId"),
        param(request, "sectionId"),
        request.body
      );
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      response.json(section);
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/projects/:projectId/sections/:sectionId",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const deleted = await deleteSection(param(request, "projectId"), param(request, "sectionId"));
      if (!deleted) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

app.post("/api/notion/schema", requireEditPassword, async (request, response, next) => {
  try {
    const sourceId = String(request.body?.dataSourceId || request.body?.databaseId || "");
    response.json(await retrieveNotionSchema(sourceId));
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/projects/:projectId/sections/:sectionId/sync",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const projectId = param(request, "projectId");
      const sectionId = param(request, "sectionId");
      const section = await getSection(projectId, sectionId);
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      if (section.type !== "nodeHistory" || section.source !== "notion") {
        response.status(400).json({ error: "Notion 노드 이력 섹션만 동기화할 수 있습니다." });
        return;
      }

      const historyNodes = await queryNotionHistoryNodes(section);
      const cached = await replaceLocalItems(projectId, sectionId, historyNodes);
      response.json(cached || []);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/projects/:projectId/sections/:sectionId/items",
  async (request, response, next) => {
    try {
      const section = await getSection(param(request, "projectId"), param(request, "sectionId"));
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      if (section.type === "table" && section.source === "notion") {
        response.json(await queryNotionRows(section));
        return;
      }

      const items = await getLocalItems(param(request, "projectId"), param(request, "sectionId"));
      response.json(items || []);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/projects/:projectId/sections/:sectionId/items",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const section = await getSection(param(request, "projectId"), param(request, "sectionId"));
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      if (section.type === "table" && section.source === "notion") {
        const values = (request.body.values || request.body) as Record<string, unknown>;
        response.status(201).json(await createNotionRow(section, values));
        return;
      }

      if (section.type === "nodeHistory" && section.source === "notion") {
        response.status(409).json({
          error: "Notion 원본 노드 이력은 동기화 캐시로만 갱신할 수 있습니다."
        });
        return;
      }

      const item = await addLocalItem(
        param(request, "projectId"),
        param(request, "sectionId"),
        request.body
      );
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  "/api/projects/:projectId/sections/:sectionId/items/:itemId",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const section = await getSection(param(request, "projectId"), param(request, "sectionId"));
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      if (section.type === "table" && section.source === "notion") {
        const values = (request.body.values || request.body) as Record<string, unknown>;
        response.json(await updateNotionRow(section, param(request, "itemId"), values));
        return;
      }

      if (section.type === "nodeHistory" && section.source === "notion") {
        response.status(409).json({
          error: "Notion 원본 노드 이력은 동기화 캐시로만 갱신할 수 있습니다."
        });
        return;
      }

      const item = await updateLocalItem(
        param(request, "projectId"),
        param(request, "sectionId"),
        param(request, "itemId"),
        request.body
      );
      if (!item) {
        response.status(404).json({ error: "항목을 찾을 수 없습니다." });
        return;
      }

      response.json(item);
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  "/api/projects/:projectId/sections/:sectionId/items/:itemId",
  requireEditPassword,
  async (request, response, next) => {
    try {
      const section = await getSection(param(request, "projectId"), param(request, "sectionId"));
      if (!section) {
        response.status(404).json({ error: "섹션을 찾을 수 없습니다." });
        return;
      }

      if (section.type === "table" && section.source === "notion") {
        await archiveNotionRow(param(request, "itemId"));
        response.status(204).send();
        return;
      }

      if (section.type === "nodeHistory" && section.source === "notion") {
        response.status(409).json({
          error: "Notion 원본 노드 이력은 동기화 캐시로만 갱신할 수 있습니다."
        });
        return;
      }

      const deleted = await deleteLocalItem(
        param(request, "projectId"),
        param(request, "sectionId"),
        param(request, "itemId")
      );
      if (!deleted) {
        response.status(404).json({ error: "항목을 찾을 수 없습니다." });
        return;
      }

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

const clientDist = path.join(process.cwd(), "dist");
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API 경로를 찾을 수 없습니다." });
});
app.use(express.static(clientDist));
app.use((request, response, next) => {
  if (request.path.startsWith("/api")) {
    next();
    return;
  }

  response.sendFile(path.join(clientDist, "index.html"));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof NotionIntegrationError) {
    response.status(error.statusCode).json({ error: "Notion 연동 오류", detail: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "서버 오류가 발생했습니다." });
});

function requireEditPassword(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.EDIT_PASSWORD || "admin";
  const provided = request.header("x-edit-password") || "";
  if (provided !== expected) {
    response.status(401).json({ error: "편집 비밀번호가 올바르지 않습니다." });
    return;
  }

  next();
}

function param(request: Request, key: string): string {
  const value = request.params[key];
  return Array.isArray(value) ? value[0] : value;
}

app.listen(port, () => {
  console.log(`Project Experience Portal API listening on http://localhost:${port}`);
});
