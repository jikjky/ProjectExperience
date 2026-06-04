export type ProjectStatus = "planning" | "inProgress" | "review" | "blocked" | "done";

export type SectionType = "nodeHistory" | "table" | "linkBoard";

export type SectionSource = "local" | "notion";

export type LinkKind = "notion" | "file" | "diagram" | "sheet" | "repo" | "other";

export type TableColumnType =
  | "text"
  | "number"
  | "date"
  | "status"
  | "url"
  | "checkbox"
  | "select";

export type NotionPropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "select"
  | "status"
  | "multi_select"
  | "people"
  | "files"
  | "formula"
  | "created_time"
  | "last_edited_time"
  | "created_by"
  | "last_edited_by";

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  kind: LinkKind;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableColumn {
  id: string;
  label: string;
  type: TableColumnType;
  required?: boolean;
  notionProperty?: string;
  notionType?: NotionPropertyType;
  readOnly?: boolean;
}

export interface NotionSchemaResponse {
  dataSourceId: string;
  columns: TableColumn[];
}

export interface TableRow {
  id: string;
  values: Record<string, unknown>;
  notionUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryNode {
  id: string;
  title: string;
  date: string;
  summary: string;
  body?: string;
  author?: string;
  notionUrl?: string;
  links: LinkItem[];
  createdAt: string;
  updatedAt: string;
}

export interface NotionTableConfig {
  dataSourceId: string;
  pageSize?: number;
  sortProperty?: string;
  sortDirection?: "ascending" | "descending";
  filters?: NotionFilterRule[];
  historyMapping?: NotionHistoryMapping;
}

export type NotionFilterOperator =
  | "equals"
  | "does_not_equal"
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than"
  | "on_or_after"
  | "on_or_before";

export interface NotionFilterRule {
  id: string;
  property: string;
  type?: NotionPropertyType;
  operator: NotionFilterOperator;
  value?: string;
}

export interface NotionHistoryMapping {
  title?: string;
  date?: string;
  summary?: string;
  body?: string;
  author?: string;
  notionUrl?: string;
}

export interface SectionDefinition {
  id: string;
  title: string;
  description?: string;
  type: SectionType;
  source: SectionSource;
  order: number;
  columns?: TableColumn[];
  notion?: NotionTableConfig;
  items: Array<HistoryNode | TableRow | LinkItem>;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  client?: string;
  line?: string;
  equipment?: string;
  status: ProjectStatus;
  summary?: string;
  tags: string[];
  sections: SectionDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsFile {
  projects: Project[];
}

export interface CanvasNodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export type CanvasLayout = Record<string, CanvasNodeLayout>;

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasLayoutState {
  nodes: CanvasLayout;
  viewport?: CanvasViewport;
}

export type SectionItem = HistoryNode | TableRow | LinkItem;

export interface ApiError {
  error: string;
  detail?: string;
}
