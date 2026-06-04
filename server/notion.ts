import type {
  HistoryNode,
  NotionFilterOperator,
  NotionFilterRule,
  NotionPropertyType,
  NotionSchemaResponse,
  SectionDefinition,
  TableColumn,
  TableColumnType,
  TableRow
} from "../shared/types.js";

const notionBaseUrl = "https://api.notion.com/v1";

interface NotionPage {
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionPropertyValue>;
}

interface NotionPropertyValue {
  id?: string;
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  number?: number | null;
  checkbox?: boolean;
  date?: { start?: string; end?: string | null } | null;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  select?: { name?: string } | null;
  status?: { name?: string } | null;
  multi_select?: Array<{ name?: string }>;
  people?: Array<{ name?: string; id?: string }>;
  files?: Array<{ name?: string }>;
  formula?: { type?: string; string?: string; number?: number; boolean?: boolean; date?: { start?: string } };
}

interface NotionDataSource {
  id: string;
  properties?: Record<string, { id?: string; type?: string; name?: string }>;
}

interface NotionDatabase {
  id: string;
  data_sources?: Array<{ id?: string; name?: string }>;
}

export class NotionIntegrationError extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
    this.name = "NotionIntegrationError";
  }
}

export async function retrieveNotionSchema(sourceId: string): Promise<NotionSchemaResponse> {
  const dataSource = await retrieveDataSourceOrDatabase(sourceId);
  return {
    dataSourceId: dataSource.id,
    columns: propertiesToColumns(dataSource.properties || {})
  };
}

export async function queryNotionRows(section: SectionDefinition): Promise<TableRow[]> {
  const dataSourceId = await resolveDataSourceId(section);
  const query: Record<string, unknown> = {
    page_size: section.notion?.pageSize || 50,
    result_type: "page"
  };

  if (section.notion?.sortProperty) {
    query.sorts = [
      {
        property: section.notion.sortProperty,
        direction: section.notion.sortDirection || "descending"
      }
    ];
  }

  const filter = buildNotionFilter(section);
  if (filter) {
    query.filter = filter;
  }

  const payload = await notionRequest(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify(query)
  });

  const columns = section.columns || [];
  return ((payload.results as NotionPage[]) || []).map((page) => pageToTableRow(page, columns));
}

export async function queryNotionHistoryNodes(section: SectionDefinition): Promise<HistoryNode[]> {
  const dataSourceId = await resolveDataSourceId(section);
  const query: Record<string, unknown> = {
    page_size: section.notion?.pageSize || 50,
    result_type: "page"
  };

  if (section.notion?.sortProperty) {
    query.sorts = [
      {
        property: section.notion.sortProperty,
        direction: section.notion.sortDirection || "descending"
      }
    ];
  }

  const filter = buildNotionFilter(section);
  if (filter) {
    query.filter = filter;
  }

  const payload = await notionRequest(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify(query)
  });

  return ((payload.results as NotionPage[]) || [])
    .map((page) => pageToHistoryNode(page, section))
    .sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      return dateCompare || right.updatedAt.localeCompare(left.updatedAt);
    });
}

export async function createNotionRow(
  section: SectionDefinition,
  values: Record<string, unknown>
): Promise<TableRow> {
  const dataSourceId = await resolveDataSourceId(section);
  const payload = await notionRequest("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: {
        type: "data_source_id",
        data_source_id: dataSourceId
      },
      properties: valuesToNotionProperties(section.columns || [], values)
    })
  });

  return pageToTableRow(payload as unknown as NotionPage, section.columns || []);
}

export async function updateNotionRow(
  section: SectionDefinition,
  pageId: string,
  values: Record<string, unknown>
): Promise<TableRow> {
  const payload = await notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: valuesToNotionProperties(section.columns || [], values)
    })
  });

  return pageToTableRow(payload as unknown as NotionPage, section.columns || []);
}

export async function archiveNotionRow(pageId: string): Promise<void> {
  await notionRequest(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      archived: true
    })
  });
}

async function notionRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new NotionIntegrationError("NOTION_API_KEY가 설정되어 있지 않습니다.", 503);
  }

  const response = await fetch(`${notionBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": process.env.NOTION_VERSION || "2026-03-11",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Notion API 요청이 실패했습니다. (${response.status})`;
    throw new NotionIntegrationError(message, response.status);
  }

  return payload;
}

async function resolveDataSourceId(section: SectionDefinition): Promise<string> {
  const sourceId = requireDataSourceId(section);
  if (section.notion?.dataSourceId === sourceId && looksLikeUuid(sourceId)) {
    try {
      const dataSource = await notionRequest(`/data_sources/${sourceId}`, { method: "GET" });
      return String(dataSource.id || sourceId);
    } catch {
      const dataSource = await retrieveDataSourceOrDatabase(sourceId);
      return dataSource.id;
    }
  }

  return sourceId;
}

function requireDataSourceId(section: SectionDefinition): string {
  const dataSourceId = section.notion?.dataSourceId?.trim();
  if (!dataSourceId) {
    throw new NotionIntegrationError("이 섹션에 Notion Data Source ID가 설정되어 있지 않습니다.", 400);
  }

  return dataSourceId;
}

async function retrieveDataSourceOrDatabase(sourceId: string): Promise<NotionDataSource> {
  const id = sourceId.trim();
  if (!id) {
    throw new NotionIntegrationError("Data Source ID가 비어 있습니다.", 400);
  }

  try {
    return (await notionRequest(`/data_sources/${id}`, { method: "GET" })) as unknown as NotionDataSource;
  } catch (error) {
    if (!(error instanceof NotionIntegrationError) || error.statusCode !== 404) {
      throw error;
    }
  }

  const database = (await notionRequest(`/databases/${id}`, { method: "GET" })) as unknown as NotionDatabase;
  const dataSourceId = database.data_sources?.find((source) => source.id)?.id;
  if (!dataSourceId) {
    throw new NotionIntegrationError("이 Database에서 Data Source를 찾을 수 없습니다.", 404);
  }

  return (await notionRequest(`/data_sources/${dataSourceId}`, {
    method: "GET"
  })) as unknown as NotionDataSource;
}

function pageToTableRow(page: NotionPage, columns: TableColumn[]): TableRow {
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    const propertyName = notionPropertyName(column);
    const property = page.properties?.[propertyName];
    values[column.id] = propertyToValue(property);
  }

  return {
    id: page.id,
    values,
    notionUrl: page.url || "",
    createdAt: "",
    updatedAt: ""
  };
}

function pageToHistoryNode(page: NotionPage, section: SectionDefinition): HistoryNode {
  const properties = page.properties || {};
  const mapping = section.notion?.historyMapping || {};
  const timestamp = new Date().toISOString();
  const title = stringProperty(
    findProperty(properties, mapping.title, ["title"], ["제목", "Title", "Name", "이름"])
  );
  const date = stringProperty(
    findProperty(properties, mapping.date, ["date"], ["날짜", "Date", "일자", "Updated"])
  );
  const summary = stringProperty(
    findProperty(properties, mapping.summary, ["rich_text"], ["요약", "Summary", "내용", "Description"])
  );
  const body = stringProperty(
    findProperty(properties, mapping.body, ["rich_text"], ["상세", "Body", "본문", "Detail", "Details"])
  );
  const author = stringProperty(
    findProperty(properties, mapping.author, ["people", "rich_text"], ["작성자", "Author", "Owner", "담당자"])
  );
  const mappedUrl = stringProperty(
    findProperty(properties, mapping.notionUrl, ["url"], ["Notion URL", "URL", "링크", "Link"])
  );

  return {
    id: page.id,
    title: title || "제목 없음",
    date: date || (page.last_edited_time || timestamp).slice(0, 10),
    summary,
    body,
    author,
    notionUrl: mappedUrl || page.url || "",
    links: [],
    createdAt: page.created_time || timestamp,
    updatedAt: page.last_edited_time || timestamp
  };
}

function valuesToNotionProperties(
  columns: TableColumn[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.readOnly || isReadOnlyNotionType(column.notionType)) {
      continue;
    }

    const propertyName = notionPropertyName(column);
    const value = values[column.id];
    if (!propertyName) {
      continue;
    }

    properties[propertyName] = valueToProperty(column, value);
  }

  return properties;
}

function buildNotionFilter(section: SectionDefinition): Record<string, unknown> | undefined {
  const rules = section.notion?.filters || [];
  const filters = rules
    .map((rule) => ruleToNotionFilter(rule, section.columns || []))
    .filter((filter): filter is Record<string, unknown> => Boolean(filter));

  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { and: filters };
}

function ruleToNotionFilter(
  rule: NotionFilterRule,
  columns: TableColumn[]
): Record<string, unknown> | undefined {
  const property = rule.property?.trim();
  const operator = rule.operator;
  if (!property || !operator) {
    return undefined;
  }

  const column = columns.find(
    (candidate) =>
      candidate.notionProperty === property ||
      candidate.label === property ||
      candidate.id === property
  );
  const type = normalizeNotionPropertyType(rule.type || column?.notionType || "rich_text");
  const value = rule.value ?? "";
  const body = notionFilterBody(type, operator, value);
  if (!body) {
    return undefined;
  }

  return {
    property,
    ...body
  };
}

function notionFilterBody(
  type: NotionPropertyType,
  operator: NotionFilterOperator,
  value: string
): Record<string, unknown> | undefined {
  if (operator === "is_empty" || operator === "is_not_empty") {
    return { [notionFilterKey(type)]: { [operator]: true } };
  }

  if (value === "") {
    return undefined;
  }

  const key = notionFilterKey(type);
  if (key === "number") {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return undefined;
    }

    return { number: { [numberOperator(operator)]: numberValue } };
  }

  if (key === "checkbox") {
    return { checkbox: { equals: value === "true" || value === "1" || value === "예" } };
  }

  if (key === "date") {
    return { date: { [dateOperator(operator)]: value } };
  }

  if (key === "select" || key === "status") {
    return { [key]: { [selectOperator(operator)]: value } };
  }

  if (key === "multi_select") {
    return { multi_select: { [multiSelectOperator(operator)]: value } };
  }

  if (key === "people" || key === "files" || key === "created_by" || key === "last_edited_by") {
    return { [key]: { [emptyCapableOperator(operator)]: value } };
  }

  return { [key]: { [textOperator(operator)]: value } };
}

function notionFilterKey(type: NotionPropertyType): string {
  if (type === "title") return "title";
  if (type === "rich_text") return "rich_text";
  if (type === "number") return "number";
  if (type === "checkbox") return "checkbox";
  if (type === "date" || type === "created_time" || type === "last_edited_time") return "date";
  if (type === "select") return "select";
  if (type === "status") return "status";
  if (type === "multi_select") return "multi_select";
  if (type === "people") return "people";
  if (type === "files") return "files";
  if (type === "created_by") return "created_by";
  if (type === "last_edited_by") return "last_edited_by";
  if (type === "url" || type === "email" || type === "phone_number") return type;
  return "rich_text";
}

function textOperator(operator: NotionFilterOperator): string {
  if (
    operator === "equals" ||
    operator === "does_not_equal" ||
    operator === "contains" ||
    operator === "does_not_contain" ||
    operator === "starts_with" ||
    operator === "ends_with"
  ) {
    return operator;
  }

  return "contains";
}

function numberOperator(operator: NotionFilterOperator): string {
  if (operator === "equals" || operator === "does_not_equal" || operator === "greater_than" || operator === "less_than") {
    return operator;
  }

  return "equals";
}

function dateOperator(operator: NotionFilterOperator): string {
  if (operator === "equals" || operator === "on_or_after" || operator === "on_or_before") {
    return operator;
  }

  return "equals";
}

function selectOperator(operator: NotionFilterOperator): string {
  if (operator === "equals" || operator === "does_not_equal") {
    return operator;
  }

  return "equals";
}

function multiSelectOperator(operator: NotionFilterOperator): string {
  if (operator === "does_not_contain") {
    return operator;
  }

  return "contains";
}

function emptyCapableOperator(operator: NotionFilterOperator): string {
  if (operator === "does_not_contain") {
    return "does_not_contain";
  }

  return "contains";
}

function propertiesToColumns(properties: Record<string, { id?: string; type?: string; name?: string }>): TableColumn[] {
  return Object.entries(properties)
    .map(([name, property], index) => {
      const notionType = normalizeNotionPropertyType(property.type);
      return {
        id: columnIdFromName(name, index),
        label: name,
        type: tableColumnTypeFromNotionType(notionType),
        required: notionType === "title",
        notionProperty: name,
        notionType,
        readOnly: isReadOnlyNotionType(notionType)
      } satisfies TableColumn;
    })
    .sort((left, right) => {
      if (left.notionType === "title") return -1;
      if (right.notionType === "title") return 1;
      return left.label.localeCompare(right.label, "ko");
    });
}

function notionPropertyName(column: TableColumn): string {
  return column.notionProperty?.trim() || column.label;
}

function findProperty(
  properties: Record<string, NotionPropertyValue>,
  mappedName: string | undefined,
  fallbackTypes: string[],
  fallbackNames: string[]
): NotionPropertyValue | undefined {
  const mapped = mappedName?.trim();
  if (mapped) {
    return propertyByName(properties, mapped);
  }

  for (const name of fallbackNames) {
    const property = propertyByName(properties, name);
    if (property) {
      return property;
    }
  }

  return Object.values(properties).find((property) =>
    property?.type ? fallbackTypes.includes(property.type) : false
  );
}

function propertyByName(
  properties: Record<string, NotionPropertyValue>,
  name: string
): NotionPropertyValue | undefined {
  if (properties[name]) {
    return properties[name];
  }

  const lower = name.toLowerCase();
  const entry = Object.entries(properties).find(([propertyName]) => propertyName.toLowerCase() === lower);
  return entry?.[1];
}

function stringProperty(property?: NotionPropertyValue): string {
  const value = propertyToValue(property);
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function propertyToValue(property?: NotionPropertyValue): unknown {
  if (!property?.type) {
    return "";
  }

  switch (property.type) {
    case "title":
      return plainText(property.title);
    case "rich_text":
      return plainText(property.rich_text);
    case "number":
      return property.number ?? "";
    case "checkbox":
      return Boolean(property.checkbox);
    case "date":
      return property.date?.start || "";
    case "url":
      return property.url || "";
    case "email":
      return property.email || "";
    case "phone_number":
      return property.phone_number || "";
    case "select":
      return property.select?.name || "";
    case "status":
      return property.status?.name || "";
    case "multi_select":
      return property.multi_select?.map((item) => item.name).filter(Boolean).join(", ") || "";
    case "people":
      return property.people?.map((item) => item.name || item.id).filter(Boolean).join(", ") || "";
    case "files":
      return property.files?.map((item) => item.name).filter(Boolean).join(", ") || "";
    case "formula":
      return formulaToValue(property.formula);
    default:
      return "";
  }
}

function valueToProperty(column: TableColumn, value: unknown): Record<string, unknown> {
  const type = column.notionType || fallbackNotionType(column);
  const text = value === undefined || value === null ? "" : String(value);

  switch (type) {
    case "title":
      return { title: text ? [{ text: { content: text } }] : [] };
    case "rich_text":
      return { rich_text: text ? [{ text: { content: text } }] : [] };
    case "number":
      return { number: text === "" ? null : Number(text) };
    case "date":
      return { date: text ? { start: text } : null };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: text || null };
    case "email":
      return { email: text || null };
    case "phone_number":
      return { phone_number: text || null };
    case "select":
      return { select: text ? { name: text } : null };
    case "multi_select":
      return {
        multi_select: text
          ? text
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean)
              .map((name) => ({ name }))
          : []
      };
    case "status":
      return { status: text ? { name: text } : null };
    default:
      return { rich_text: text ? [{ text: { content: text } }] : [] };
  }
}

function normalizeNotionPropertyType(type: string | undefined): NotionPropertyType {
  const knownTypes: NotionPropertyType[] = [
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

  return knownTypes.includes(type as NotionPropertyType)
    ? (type as NotionPropertyType)
    : "rich_text";
}

function tableColumnTypeFromNotionType(type: NotionPropertyType): TableColumnType {
  if (type === "number") return "number";
  if (type === "date" || type === "created_time" || type === "last_edited_time") return "date";
  if (type === "checkbox") return "checkbox";
  if (type === "url" || type === "email" || type === "phone_number") return "url";
  if (type === "status") return "status";
  if (type === "select" || type === "multi_select") return "select";
  return "text";
}

function isReadOnlyNotionType(type: NotionPropertyType | undefined): boolean {
  return (
    type === "formula" ||
    type === "files" ||
    type === "people" ||
    type === "created_time" ||
    type === "last_edited_time" ||
    type === "created_by" ||
    type === "last_edited_by"
  );
}

function columnIdFromName(name: string, index: number): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `col${index + 1}`;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function fallbackNotionType(column: TableColumn): TableColumn["notionType"] {
  if (column.type === "number") return "number";
  if (column.type === "date") return "date";
  if (column.type === "checkbox") return "checkbox";
  if (column.type === "url") return "url";
  if (column.type === "status") return "status";
  if (column.type === "select") return "select";
  return "rich_text";
}

function plainText(parts?: Array<{ plain_text?: string }>): string {
  return parts?.map((part) => part.plain_text || "").join("") || "";
}

function formulaToValue(formula?: NotionPropertyValue["formula"]): unknown {
  if (!formula?.type) {
    return "";
  }

  if (formula.type === "string") return formula.string || "";
  if (formula.type === "number") return formula.number ?? "";
  if (formula.type === "boolean") return Boolean(formula.boolean);
  if (formula.type === "date") return formula.date?.start || "";
  return "";
}
