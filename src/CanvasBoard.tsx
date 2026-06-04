import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import {
  CalendarClock,
  Database,
  FileText,
  GitBranch,
  Link2,
  Maximize2,
  Plus,
  Search,
  Table2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type {
  CanvasLayout,
  CanvasLayoutState,
  CanvasNodeLayout,
  CanvasViewport,
  HistoryNode,
  LinkItem,
  Project,
  SectionDefinition,
  TableRow
} from "./types";

type CanvasNodeKind = "project" | "section" | "historyItem";

interface CanvasNodeData {
  kind: CanvasNodeKind;
  project: Project;
  section?: SectionDefinition;
  historyItem?: HistoryNode;
  selected: boolean;
  searchQuery: string;
  searchText: string;
  historyIndex?: number;
  historyTotal?: number;
  onAddHistoryNode?: (
    projectId: string,
    sectionId: string,
    target?: { itemId: string; position: "before" | "after" }
  ) => void;
}

interface CanvasBoardProps {
  projects: Project[];
  selectedProject: Project | null;
  selectedSectionId: string;
  searchQuery: string;
  onSelectProject: (projectId: string) => void;
  onSelectSection: (projectId: string, sectionId: string) => void;
  onAddHistoryNode: (
    projectId: string,
    sectionId: string,
    target?: { itemId: string; position: "before" | "after" }
  ) => void;
}

const nodeTypes = {
  portalNode: PortalNode
};

const canvasLayoutKey = "project-experience-canvas-layout-v3";

const statusLabels = {
  planning: "계획",
  inProgress: "진행",
  review: "검토",
  blocked: "이슈",
  done: "완료"
};

export function CanvasBoard({
  projects,
  selectedProject,
  selectedSectionId,
  searchQuery,
  onSelectProject,
  onSelectSection,
  onAddHistoryNode
}: CanvasBoardProps) {
  const initialCanvasStateRef = useRef<CanvasLayoutState>(readCanvasState());
  const savedLayoutRef = useRef<CanvasLayout>(initialCanvasStateRef.current.nodes);
  const savedViewportRef = useRef<CanvasViewport | undefined>(initialCanvasStateRef.current.viewport);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const serverLayoutLoadedRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const [notionTableItems, setNotionTableItems] = useState<Record<string, TableRow[]>>({});
  const selectedProjectForCanvas = useMemo(
    () => mergeNotionTableItems(selectedProject, notionTableItems),
    [selectedProject, notionTableItems]
  );
  const initialGraph = useMemo(
    () => {
      const graph = buildGraph(
        projects,
        selectedProjectForCanvas,
        selectedSectionId,
        searchQuery,
        onAddHistoryNode
      );
      return {
        nodes: mergeGraphNodes(graph.nodes, [], savedLayoutRef.current),
        edges: graph.edges
      };
    },
    [projects, selectedProjectForCanvas, selectedSectionId, searchQuery, onAddHistoryNode]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  function scheduleServerSave() {
    if (!serverLayoutLoadedRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    const state: CanvasLayoutState = {
      nodes: savedLayoutRef.current,
      ...(savedViewportRef.current ? { viewport: savedViewportRef.current } : {})
    };

    saveTimerRef.current = window.setTimeout(() => {
      void api.saveCanvasLayout(state).catch(() => {
        // The browser cache remains as a fallback if file-backed persistence fails.
      });
    }, 350);
  }

  useEffect(() => {
    let cancelled = false;

    void api
      .getCanvasLayout()
      .then((layout) => {
        if (cancelled) {
          return;
        }

        const serverHasNodes = Object.keys(layout.nodes).length > 0;
        const nextNodesLayout = serverHasNodes ? layout.nodes : savedLayoutRef.current;
        const nextViewport = layout.viewport || savedViewportRef.current;

        savedLayoutRef.current = nextNodesLayout;
        savedViewportRef.current = nextViewport;
        setNodes((current) => applyCanvasLayout(current, nextNodesLayout));
        if (nextViewport && flowRef.current) {
          void flowRef.current.setViewport(nextViewport, { duration: 0 });
        }
      })
      .catch(() => {
        // Keep the localStorage fallback when the server is unavailable.
      })
      .finally(() => {
        if (!cancelled) {
          serverLayoutLoadedRef.current = true;
          scheduleServerSave();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setNodes]);

  useEffect(() => {
    let cancelled = false;
    const notionSections =
      selectedProject?.sections.filter(
        (section) => section.type === "table" && section.source === "notion"
      ) || [];

    if (notionSections.length === 0 || !selectedProject) {
      setNotionTableItems({});
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      notionSections.map(async (section) => {
        try {
          const items = await api.getItems(selectedProject.id, section.id);
          return [section.id, items as TableRow[]] as const;
        } catch {
          return [section.id, []] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      setNotionTableItems(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  useEffect(() => {
    const graph = buildGraph(
      projects,
      selectedProjectForCanvas,
      selectedSectionId,
      searchQuery,
      onAddHistoryNode
    );
    setNodes((current) => mergeGraphNodes(graph.nodes, current, savedLayoutRef.current));
    setEdges(graph.edges);
  }, [projects, selectedProjectForCanvas, selectedSectionId, searchQuery, onAddHistoryNode, setEdges, setNodes]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          searchQuery
        }
      }))
    );
  }, [searchQuery, setNodes]);

  useEffect(() => {
    const currentViewport = flowRef.current?.getViewport();
    if (currentViewport) {
      savedViewportRef.current = viewportToCanvasViewport(currentViewport);
    }

    savedLayoutRef.current = persistCanvasStateLocal(
      savedLayoutRef.current,
      savedViewportRef.current,
      nodes
    );
    scheduleServerSave();
  }, [nodes]);

  return (
    <div className="canvas-board">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => {
          flowRef.current = instance;
          if (savedViewportRef.current) {
            void instance.setViewport(savedViewportRef.current, { duration: 0 });
          }
        }}
        onMoveEnd={(_, viewport) => {
          savedViewportRef.current = viewportToCanvasViewport(viewport);
          persistCanvasStateLocal(savedLayoutRef.current, savedViewportRef.current, nodes);
          scheduleServerSave();
        }}
        onNodeClick={(_, node) => {
          const data = node.data as unknown as CanvasNodeData;
          if (data.kind === "project") {
            onSelectProject(data.project.id);
            return;
          }

          if (data.section) {
            onSelectSection(data.project.id, data.section.id);
          }
        }}
        fitView={!savedViewportRef.current}
        defaultViewport={savedViewportRef.current}
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.8}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1.6 }
        }}
      >
        <Background color="#c7d0d7" gap={22} size={1} variant={BackgroundVariant.Dots} />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="canvas-help">
          <Search size={15} />
          <span>검색어와 맞는 노드가 강조됩니다</span>
        </Panel>
        <Panel position="top-right" className="canvas-help">
          <Maximize2 size={15} />
          <span>드래그, 팬, 줌으로 전체 흐름을 확인</span>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function PortalNode(props: NodeProps) {
  const data = props.data as unknown as CanvasNodeData;
  const section = data.section;
  const query = data.searchQuery.trim().toLowerCase();
  const matched = !query || data.searchText.toLowerCase().includes(query);
  const className = [
    "canvas-node",
    data.kind === "project" ? "project-canvas-node" : "",
    data.kind === "section" ? "section-canvas-node" : "",
    data.kind === "historyItem" ? "history-item-canvas-node" : "",
    data.selected ? "selected" : "",
    query && matched ? "matched" : "",
    query && !matched ? "dimmed" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <NodeResizer
        isVisible={props.selected || data.selected}
        minWidth={220}
        minHeight={130}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <article className={className}>
        <Handle type="target" position={Position.Top} />
        {data.kind === "project" ? (
          <ProjectCanvasNode project={data.project} />
        ) : section ? (
          data.kind === "historyItem" && data.historyItem ? (
            <HistoryItemCanvasNode data={data} item={data.historyItem} />
          ) : (
            <SectionCanvasNode data={data} section={section} />
          )
        ) : null}
        <Handle type="source" position={Position.Bottom} />
      </article>
    </>
  );
}

function HistoryItemCanvasNode({ data, item }: { data: CanvasNodeData; item: HistoryNode }) {
  const canEdit = data.section?.source === "local";
  return (
    <>
      {canEdit && data.section && (
        <div className="canvas-node-actions nodrag nopan">
          <button
            type="button"
            title="이 노드 위에 삽입"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddHistoryNode?.(data.project.id, data.section!.id, {
                itemId: item.id,
                position: "before"
              });
            }}
          >
            <Plus size={14} />
            위
          </button>
          <button
            type="button"
            title="이 노드 아래에 삽입"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddHistoryNode?.(data.project.id, data.section!.id, {
                itemId: item.id,
                position: "after"
              });
            }}
          >
            <Plus size={14} />
            아래
          </button>
        </div>
      )}
      <div className="canvas-node-top">
        <span className="section-node-icon">
          <GitBranch size={15} />
        </span>
        <span className="canvas-node-type">history node</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.summary || "요약 없음"}</p>
      {item.body && <pre className="history-item-body">{item.body}</pre>}
      <div className="canvas-node-footer">
        <CalendarClock size={15} />
        <span>{item.date}</span>
        {item.author && <span>{item.author}</span>}
      </div>
    </>
  );
}

function ProjectCanvasNode({ project }: { project: Project }) {
  return (
    <>
      <div className="canvas-node-top">
        <span className={`status-pill ${project.status}`}>{statusLabels[project.status]}</span>
        <span className="canvas-node-type">PROJECT</span>
      </div>
      <h3>{project.name}</h3>
      <p>{project.summary || "요약 없음"}</p>
      <div className="canvas-node-meta">
        <span>{project.client || "고객 미지정"}</span>
        <span>{project.line || "라인 미지정"}</span>
        <span>{project.equipment || "장비 미지정"}</span>
      </div>
      <div className="canvas-node-footer">
        <CalendarClock size={15} />
        <span>{formatShortDate(project.updatedAt)}</span>
      </div>
    </>
  );
}

function SectionCanvasNode({ data, section }: { data: CanvasNodeData; section: SectionDefinition }) {
  const canAddHistory = section.type === "nodeHistory" && section.source === "local";
  return (
    <>
      {canAddHistory && (
        <div className="canvas-node-actions nodrag nopan">
          <button
            type="button"
            title="최신 이력 노드 추가"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddHistoryNode?.(data.project.id, section.id);
            }}
          >
            <Plus size={14} />
            최신
          </button>
        </div>
      )}
      <div className="canvas-node-top">
        <span className="section-node-icon">{sectionIcon(section)}</span>
        <span className="canvas-node-type">{section.type}</span>
        <span>{section.source}</span>
      </div>
      <h3>{section.title}</h3>
      {section.description && <p>{section.description}</p>}
      {section.type === "table" && <TablePreview section={section} />}
      {section.type === "nodeHistory" && <HistoryPreview section={section} />}
      {section.type === "linkBoard" && <LinkPreview section={section} />}
    </>
  );
}

function TablePreview({ section }: { section: SectionDefinition }) {
  const columns = section.columns || [];
  const rows = section.items as TableRow[];
  return (
    <div className="node-table-preview">
      <div className="node-table-head">
        {columns.slice(0, 4).map((column) => (
          <span key={column.id}>{column.label}</span>
        ))}
      </div>
      {rows.length > 0 ? (
        rows.slice(0, 3).map((row) => (
          <div className="node-table-row" key={row.id}>
            {columns.slice(0, 4).map((column) => (
              <span key={column.id}>{String(row.values[column.id] ?? "-")}</span>
            ))}
          </div>
        ))
      ) : section.source === "notion" ? (
        <div className="node-table-row notion-row">
          <Database size={14} />
          <span>Notion Data Source</span>
        </div>
      ) : (
        <div className="node-table-row notion-row">
          <Table2 size={14} />
          <span>행 없음</span>
        </div>
      )}
      <small>
        {columns.length} columns · {section.source === "notion" ? `${rows.length} notion rows` : `${rows.length} rows`}
      </small>
    </div>
  );
}

function HistoryPreview({ section }: { section: SectionDefinition }) {
  const nodes = section.items as HistoryNode[];
  const latest = nodes[0];
  return (
    <div className="node-history-preview">
      <GitBranch size={16} />
      <div>
        <strong>{latest?.title || "이력 없음"}</strong>
        <span>{latest ? `${latest.date} · ${latest.summary}` : "노드를 추가하세요"}</span>
      </div>
      <small>{nodes.length} nodes</small>
    </div>
  );
}

function LinkPreview({ section }: { section: SectionDefinition }) {
  const links = section.items as LinkItem[];
  return (
    <div className="node-link-preview">
      {links.slice(0, 4).map((link) => (
        <span key={link.id}>
          <Link2 size={13} />
          {link.title}
        </span>
      ))}
      <small>{links.length} links</small>
    </div>
  );
}

function mergeNotionTableItems(
  project: Project | null,
  notionTableItems: Record<string, TableRow[]>
): Project | null {
  if (!project) {
    return null;
  }

  return {
    ...project,
    sections: project.sections.map((section) =>
      section.type === "table" && section.source === "notion" && notionTableItems[section.id]
        ? { ...section, items: notionTableItems[section.id] }
        : section
    )
  };
}

function buildGraph(
  projects: Project[],
  selectedProject: Project | null,
  selectedSectionId: string,
  searchQuery: string,
  onAddHistoryNode?: CanvasNodeData["onAddHistoryNode"]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const projectGap = 320;
  const sectionGapX = 360;
  const sectionBaseY = 330;
  const sectionYByColumn = [sectionBaseY, sectionBaseY];
  const selectedId = selectedProject?.id || projects[0]?.id || "";

  projects.forEach((project, index) => {
      nodes.push({
      id: `project:${project.id}`,
      type: "portalNode",
      position: { x: 160 + index * projectGap, y: 70 },
      style: { width: 300, height: 190 },
      data: {
        kind: "project",
        project,
        selected: project.id === selectedId,
        searchQuery,
        onAddHistoryNode,
        searchText: [
          project.name,
          project.client,
          project.line,
          project.equipment,
          project.summary,
          project.status,
          ...project.tags
        ]
          .filter(Boolean)
          .join(" ")
      } satisfies CanvasNodeData
    });
  });

  if (!selectedProject) {
    return { nodes, edges };
  }

  selectedProject.sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .forEach((section, index) => {
      const column = index % 2;
      const sectionNodeId = `section:${section.id}`;
      const sectionPosition = { x: 80 + column * sectionGapX, y: sectionYByColumn[column] };
      const historyItems = section.type === "nodeHistory" ? (section.items as HistoryNode[]) : [];
      nodes.push({
        id: sectionNodeId,
        type: "portalNode",
        position: sectionPosition,
        style: { width: 280, height: defaultSectionHeight(section) },
        data: {
          kind: "section",
          project: selectedProject,
          section,
          selected: section.id === selectedSectionId,
          searchQuery,
          onAddHistoryNode,
          searchText: sectionSearchText(section)
        } satisfies CanvasNodeData
      });
      edges.push({
        id: `edge:${selectedProject.id}:${section.id}`,
        source: `project:${selectedProject.id}`,
        target: sectionNodeId,
        type: "smoothstep",
        animated: section.id === selectedSectionId
      });

      if (section.type === "nodeHistory") {
        historyItems.forEach((item, itemIndex) => {
          const itemNodeId = `history:${section.id}:${item.id}`;
          const position = historyItemPosition(sectionPosition, section, itemIndex, historyItems.length);
          nodes.push({
            id: itemNodeId,
            type: "portalNode",
            position,
            style: { width: 240, height: 170 },
            data: {
              kind: "historyItem",
              project: selectedProject,
              section,
              historyItem: item,
              selected: section.id === selectedSectionId,
              searchQuery,
              onAddHistoryNode,
              historyIndex: itemIndex,
              historyTotal: historyItems.length,
              searchText: `${section.title} ${item.title} ${item.date} ${item.summary} ${item.body || ""} ${
                item.author || ""
              }`
            } satisfies CanvasNodeData
          });

          edges.push({
            id:
              itemIndex === 0
                ? `edge:${section.id}:history:${item.id}`
                : `edge:${section.id}:history:${historyItems[itemIndex - 1].id}:${item.id}`,
            source:
              itemIndex === 0
                ? sectionNodeId
                : `history:${section.id}:${historyItems[itemIndex - 1].id}`,
            target: itemNodeId,
            type: "smoothstep",
            animated: section.id === selectedSectionId
          });
        });
      }

      const historyRows = historyItems.length;
      sectionYByColumn[column] +=
        defaultSectionHeight(section) + 90 + (historyRows > 0 ? historyRows * 205 + 30 : 0);
    });

  return { nodes, edges };
}

function historyItemPosition(
  sectionPosition: { x: number; y: number },
  section: SectionDefinition,
  index: number,
  _total: number
): { x: number; y: number } {
  const itemWidth = 240;
  const verticalGap = 205;
  const sectionCenterX = sectionPosition.x + 140;

  return {
    x: sectionCenterX - itemWidth / 2,
    y: sectionPosition.y + defaultSectionHeight(section) + 78 + index * verticalGap
  };
}

function mergeGraphNodes(
  nextNodes: Node[],
  currentNodes: Node[],
  savedLayout: CanvasLayout
): Node[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const current = currentById.get(nextNode.id);
    const saved = savedLayout[nextNode.id];
    const width = current?.width ?? numericStyleValue(current?.style?.width) ?? saved?.width;
    const height = current?.height ?? numericStyleValue(current?.style?.height) ?? saved?.height;

    return {
      ...nextNode,
      position: current?.position || (saved ? { x: saved.x, y: saved.y } : nextNode.position),
      style: {
        ...nextNode.style,
        ...(width ? { width } : {}),
        ...(height ? { height } : {})
      }
    };
  }).map((node, _index, allNodes) => {
    const data = node.data as unknown as CanvasNodeData;
    const hasExistingLayout = Boolean(currentById.get(node.id) || savedLayout[node.id]);
    if (data.kind !== "historyItem" || !data.section || hasExistingLayout) {
      return node;
    }

    const sectionNode = allNodes.find((candidate) => candidate.id === `section:${data.section?.id}`);
    if (!sectionNode || data.historyIndex === undefined || data.historyTotal === undefined) {
      return node;
    }

    return {
      ...node,
      position: historyItemPosition(
        sectionNode.position,
        data.section,
        data.historyIndex,
        data.historyTotal
      )
    };
  });
}

function persistCanvasStateLocal(
  previous: CanvasLayout,
  viewport: CanvasViewport | undefined,
  nodes: Node[]
): CanvasLayout {
  const next = { ...previous };
  for (const node of nodes) {
    next[node.id] = {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? numericStyleValue(node.style?.width),
      height: node.height ?? numericStyleValue(node.style?.height)
    };
  }

  try {
    window.localStorage.setItem(
      canvasLayoutKey,
      JSON.stringify({
        nodes: next,
        ...(viewport ? { viewport } : {})
      })
    );
  } catch {
    // Layout persistence is best-effort; the canvas still works without storage.
  }

  return next;
}

function readCanvasState(): CanvasLayoutState {
  try {
    const raw = window.localStorage.getItem(canvasLayoutKey);
    if (!raw) {
      return { nodes: {} };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { nodes: {} };
    }

    const candidate = parsed as Record<string, unknown>;
    if (candidate.nodes && typeof candidate.nodes === "object") {
      return {
        nodes: candidate.nodes as CanvasLayout,
        viewport: candidate.viewport as CanvasViewport | undefined
      };
    }

    return { nodes: candidate as CanvasLayout };
  } catch {
    return { nodes: {} };
  }
}

function applyCanvasLayout(nodes: Node[], savedLayout: CanvasLayout): Node[] {
  return nodes.map((node) => {
    const saved = savedLayout[node.id];
    if (!saved) {
      return node;
    }

    return {
      ...node,
      position: { x: saved.x, y: saved.y },
      style: {
        ...node.style,
        ...(saved.width ? { width: saved.width } : {}),
        ...(saved.height ? { height: saved.height } : {})
      }
    };
  });
}

function viewportToCanvasViewport(viewport: Viewport): CanvasViewport {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom
  };
}

function numericStyleValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function defaultSectionHeight(section: SectionDefinition): number {
  if (section.type === "table") {
    return 235;
  }

  if (section.type === "nodeHistory") {
    return 205;
  }

  return 190;
}

function sectionSearchText(section: SectionDefinition): string {
  const columns = section.columns?.map((column) => `${column.id} ${column.label}`).join(" ") || "";
  const items = section.items
    .map((item) => {
      if ("values" in item) return Object.values(item.values).join(" ");
      if ("summary" in item) return `${item.title} ${item.summary} ${item.body || ""}`;
      return `${item.title} ${item.url} ${item.description || ""}`;
    })
    .join(" ");

  return [section.title, section.description, section.type, section.source, columns, items]
    .filter(Boolean)
    .join(" ");
}

function sectionIcon(section: SectionDefinition) {
  if (section.type === "nodeHistory") return <GitBranch size={15} />;
  if (section.type === "table") return section.source === "notion" ? <Database size={15} /> : <Table2 size={15} />;
  return <FileText size={15} />;
}

function formatShortDate(value: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
