/**
 * 办事大厅动态表单引擎（移植自 SCU-CLI `internal/api/service_form.go`）。
 *
 * 数据流：start-data（auth 权限 + data 预填 + currform 表单 id）
 *   + get-formv（插件定义，plugins 为二次编码 JSON）
 *   → ServiceSchema（字段类型/选项/标签/排序/显隐规则）
 *   → buildServiceFormData（按类型序列化，隐藏字段回填占位值）
 *
 * 这里只做纯解析与序列化，不发起请求，便于单测。
 */

export type ServiceFieldType =
  | 'input'
  | 'multiInput'
  | 'radio'
  | 'select'
  | 'selectV2'
  | 'checkbox'
  | 'calendar'
  | 'region'
  | 'file'
  | 'dataSource'
  | 'user'
  | 'showHide'
  | 'variate'
  | 'validate'
  | 'conversion'
  | 'repeatTable'
  | 'text'
  | 'image'
  | 'table'
  | 'unknown';

export interface ServiceFieldOption {
  readonly value: string;
  readonly name: string;
}

export interface ServiceField {
  readonly key: string;
  readonly type: ServiceFieldType;
  readonly label: string;
  readonly sort: number;
  readonly options: readonly ServiceFieldOption[];
  readonly hint: string;
  /** 附件数量上限；0 视为默认 3。 */
  readonly maxCount: number;
  /** 静态必填（auth=require）；ShowHide 动态必填另算。 */
  readonly required: boolean;
  readonly readOnly: boolean;
  /** auth 标记为 hidden/forbidden：不渲染，提交占位值。 */
  readonly suppressed: boolean;
  /** DataSource 字段的取数配置（sourceid/resultKey/mapConfig/sourceConfig）。 */
  readonly dataSource: ServiceDataSourceRef | null;
  /** Validate 插件的日期顺序校验（{f_dateDayMinus}({p_A},{p_B})<0）。 */
  readonly dateRule: ServiceDateOrderRule | null;
}

/** DataSource 取数配置（POST /site/data-source/detail 的入参来源）。 */
export interface ServiceDataSourceRef {
  readonly id: string;
  /** 配对字段 key；"setplugin" 表示按 mapConfig 分发多列。 */
  readonly resultKey: string;
  /** setplugin 模式：目标字段 key → 结果列名。 */
  readonly mapConfig: Readonly<Record<string, string>>;
  /** sourceConfig 附加参数。 */
  readonly configure: Readonly<Record<string, string>>;
  readonly isSetPlugin: boolean;
}

/** Validate 日期顺序校验规则：A 必须早于等于 B。 */
export interface ServiceDateOrderRule {
  readonly firstKey: string;
  readonly secondKey: string;
  readonly message: string;
}

export interface ServiceShowHideRule {
  readonly conditions: readonly { readonly name: string; readonly expression: string }[];
  readonly controls: Readonly<
    Record<
      string,
      {
        readonly isShow?: boolean;
        readonly isRequired?: boolean;
        readonly clearWhenHidden: boolean;
        readonly targets: readonly string[];
      }
    >
  >;
}

export interface ServiceSchema {
  readonly appId: string;
  readonly formId: string;
  readonly formVersionId: string;
  readonly fields: readonly ServiceField[];
  /** 字段 key → 权限（require/readable/hidden…）。 */
  readonly auth: Readonly<Record<string, string>>;
  /** 字段 key → 预填值。 */
  readonly data: Readonly<Record<string, unknown>>;
  readonly showHide: readonly ServiceShowHideRule[];
}

export interface ServiceAttachment {
  readonly name: string;
  readonly url: string;
  readonly id: string;
}

const PREFIX_TYPES: readonly [string, ServiceFieldType][] = [
  ['MultiInput_', 'multiInput'],
  ['MultiText_', 'multiInput'],
  ['SelectV2_', 'selectV2'],
  ['RepeatTable_', 'repeatTable'],
  ['DataSource_', 'dataSource'],
  ['Conversion_', 'conversion'],
  ['ShowHide_', 'showHide'],
  ['Checkbox_', 'checkbox'],
  ['Calendar_', 'calendar'],
  ['Validate_', 'validate'],
  ['Variate_', 'variate'],
  ['Select_', 'select'],
  ['Region_', 'region'],
  ['Input_', 'input'],
  ['Radio_', 'radio'],
  ['File_', 'file'],
  ['Ximage_', 'file'],
  ['User_', 'user'],
  ['Text_', 'text'],
  ['Image_', 'image'],
  ['Table_', 'table'],
];

const COMPONENT_TYPES: Record<string, ServiceFieldType> = {
  input: 'input',
  integerinput: 'input',
  numericinput: 'input',
  phonenumber: 'input',
  multitext: 'multiInput',
  multiinputs: 'multiInput',
  radio: 'radio',
  select: 'select',
  selectv2: 'selectV2',
  checkbox: 'checkbox',
  calendar: 'calendar',
  region: 'region',
  file: 'file',
  ximage: 'file',
  datasource: 'dataSource',
  user: 'user',
  showhide: 'showHide',
  variate: 'variate',
  validate: 'validate',
  conversion: 'conversion',
  repeattable: 'repeatTable',
  oneinput: 'text',
  text: 'text',
  show: 'text',
  image: 'image',
  table: 'table',
};

/** 不渲染、提交时只给占位值的类型。 */
const PLACEHOLDER_TYPES = new Set<ServiceFieldType>([
  'showHide',
  'variate',
  'validate',
  'conversion',
  'repeatTable',
  'text',
  'image',
  'table',
  'unknown',
]);

/** 提交空值时是数组的类型。 */
const ARRAY_PLACEHOLDER_TYPES = new Set<ServiceFieldType>([
  'conversion',
  'repeatTable',
  'selectV2',
  'checkbox',
  'file',
]);

export function fieldTypeFromKey(key: string): ServiceFieldType {
  for (const [prefix, type] of PREFIX_TYPES) if (key.startsWith(prefix)) return type;
  return 'unknown';
}

/** 优先用组件声明（dRadio 之类，大小写不敏感），缺失时按 key 前缀推断。 */
export function resolveFieldType(declared: string, key: string): ServiceFieldType {
  if (declared) {
    let name = declared.trim().toLowerCase();
    if (name.startsWith('d') && name.length > 1) name = name.slice(1);
    const type = COMPONENT_TYPES[name];
    if (type) return type;
  }
  return fieldTypeFromKey(key);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

function firstString(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return '';
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

/** 服务端常把对象二次编码为 JSON 字符串。 */
function maybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function parseOptions(data: Record<string, unknown>): ServiceFieldOption[] {
  for (const key of ['options', 'items', 'list', 'option']) {
    const raw = data[key];
    if (!Array.isArray(raw)) continue;
    const options = raw.flatMap((item) => {
      if (!isRecord(item)) return [];
      const name = firstString(item, ['name', 'label', 'title']);
      const value = firstString(item, ['value', 'id']);
      return name && value ? [{ value, name }] : [];
    });
    if (options.length > 0) return options;
  }
  return [];
}

function parseShowHide(data: Record<string, unknown>): ServiceShowHideRule | null {
  const rawConditions = data.conditions;
  const rawControls = data.controls;
  if (!rawConditions || !rawControls) return null;

  const conditions: { name: string; expression: string }[] = [];
  const addCondition = (value: unknown) => {
    if (!isRecord(value)) return;
    conditions.push({ name: text(value.name), expression: text(value.expression) });
  };
  if (Array.isArray(rawConditions)) rawConditions.forEach(addCondition);
  else if (isRecord(rawConditions)) {
    const keys = Object.keys(rawConditions).sort((a, b) => toInt(a) - toInt(b));
    for (const key of keys) addCondition(rawConditions[key]);
  }
  if (conditions.length === 0) return null;

  const controls: Record<string, ServiceShowHideRule['controls'][string]> = {};
  if (Array.isArray(rawControls)) {
    for (const item of rawControls) {
      if (!isRecord(item)) continue;
      const conkey = firstString(item, ['conkey']);
      const setInfo = item.setInfo;
      if (!conkey || !isRecord(setInfo)) continue;
      const isShowRaw = toInt(setInfo.isShow, -1);
      const isRequiredRaw = toInt(setInfo.isRequired, -1);
      const targets = Array.isArray(setInfo.plugins)
        ? setInfo.plugins.map((target) => text(target)).filter(Boolean)
        : [];
      controls[conkey] = {
        ...(isShowRaw === -1 ? {} : { isShow: isShowRaw === 1 }),
        ...(isRequiredRaw === -1 ? {} : { isRequired: isRequiredRaw === 1 }),
        clearWhenHidden: toInt(setInfo.isEmpty, 0) === 1,
        targets,
      };
    }
  }
  return { conditions, controls };
}

/** 解析 get-formv 的 plugins（支持数组 / Map / 双层编码）。 */
export function parsePlugins(raw: unknown): Record<string, unknown>[] {
  let value = maybeJson(raw);
  if (isRecord(value) && value.plugins !== undefined) value = maybeJson(value.plugins);
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return Object.values(value).filter(isRecord);
  return [];
}

/** Validate 日期顺序规则：{f_dateDayMinus}({p_A},{p_B})<0，语义 A 必须早于等于 B。 */
const DATE_ORDER_RULE_RE =
  /^\s*\{f_dateDayMinus\}\(\s*\{p_([A-Za-z0-9_]+)\}\s*,\s*\{p_([A-Za-z0-9_]+)\}\s*\)\s*<\s*0\s*$/;

function parseDateOrderRule(data: Record<string, unknown>): ServiceDateOrderRule | null {
  const rule = text(data.rule);
  const match = DATE_ORDER_RULE_RE.exec(rule);
  if (!match) return null;
  return { firstKey: match[1]!, secondKey: match[2]!, message: text(data.alert) };
}

/** mapConfig 真实形态 {User_156: {key: "grade"}}。 */
function parseMapConfig(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw))
    if (isRecord(value) && value.key !== undefined) out[key] = text(value.key);
  return out;
}

/** sourceConfig 结构 {key: {value: ...}} 或 {key: 值}。 */
function parseSourceConfig(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value) && value.value !== undefined) out[key] = text(value.value);
    else if (value !== null && value !== undefined) out[key] = text(value);
  }
  return out;
}

function parseDataSourceRef(
  type: ServiceFieldType,
  data: Record<string, unknown>,
): ServiceDataSourceRef | null {
  if (type !== 'dataSource') return null;
  const id = firstString(data, ['sourceid', 'source_id', 'data_source_id', 'dataSourceId']);
  if (!id) return null;
  const resultKey = firstString(data, ['resultKey']);
  return {
    id,
    resultKey,
    mapConfig: parseMapConfig(data.mapConfig),
    configure: parseSourceConfig(data.sourceConfig),
    isSetPlugin: resultKey === 'setplugin',
  };
}

function parseField(
  plugin: Record<string, unknown>,
  fallbackKey: string,
  formId: string,
  formVersionId: string,
): { field: ServiceField; showHide: ServiceShowHideRule | null } {
  void formId;
  void formVersionId;
  const key = firstString(plugin, ['key', 'dataid', 'id']) || fallbackKey;
  const attr = isRecord(plugin.attr) ? plugin.attr : {};
  const data = isRecord(attr.data) ? attr.data : {};
  const type = resolveFieldType(firstString(plugin, ['type', 'component']), key);
  const label =
    firstString(plugin, ['description', 'label', 'title']) ||
    firstString(data, ['label', 'title', 'name']);
  const maxCountRaw = toInt(data.maxNum ?? data.maxCount, 0);
  return {
    field: {
      key,
      type,
      label,
      sort: toInt(plugin.sort, toInt(data.sort, 0)),
      options: parseOptions(data),
      hint: firstString(data, ['placeholder', 'hint', 'tip']),
      maxCount: maxCountRaw > 0 ? maxCountRaw : 3,
      required: false,
      readOnly: false,
      suppressed: false,
      dataSource: parseDataSourceRef(type, data),
      dateRule: type === 'validate' ? parseDateOrderRule(data) : null,
    },
    showHide: type === 'showHide' ? parseShowHide(data) : null,
  };
}

/** start-data 的 d：currform[0] 是表单 id（数字），auth/data 以字符串 key 索引。 */
export function parseFormDefinition(d: Record<string, unknown>): {
  formId: string;
  auth: Record<string, string>;
  data: Record<string, unknown>;
} {
  const curr = d.currform;
  const formId = Array.isArray(curr) && curr.length > 0 ? text(curr[0]) : '';
  const auth: Record<string, string> = {};
  const data: Record<string, unknown> = {};
  if (formId && isRecord(d.auth) && isRecord(d.auth[formId]))
    for (const [key, value] of Object.entries(d.auth[formId] as Record<string, unknown>))
      auth[key] = text(value);
  if (formId && isRecord(d.data) && isRecord(d.data[formId]))
    Object.assign(data, d.data[formId] as Record<string, unknown>);
  return { formId, auth, data };
}

const READ_ONLY_AUTH = new Set(['readable', 'front_readonly', 'readonly']);

/** 合并插件定义与 start-data 权限，得到可渲染的 schema。 */
export function buildServiceSchema(
  appId: string,
  formv: Record<string, unknown>,
  definition: { formId: string; auth: Record<string, string>; data: Record<string, unknown> },
): ServiceSchema {
  const formId = firstString(formv, ['id', 'form_id', 'formId']) || definition.formId;
  const formVersionId = firstString(formv, ['form_version_id', 'version_id', 'formVersionId']);
  const entries = parsePlugins(formv.plugins);
  if (entries.length === 0) throw new Error('表单定义为空：服务端未下发可解析的插件');

  const fields: ServiceField[] = [];
  const showHide: ServiceShowHideRule[] = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = parseField(entry, `plugin_${index}`, formId, formVersionId);
    if (!parsed.field.key) continue;
    const auth = definition.auth[parsed.field.key] ?? '';
    const readOnly = READ_ONLY_AUTH.has(auth);
    const suppressed = auth === 'hidden' || auth === 'forbidden';
    fields.push({
      ...parsed.field,
      required: auth === 'require',
      readOnly,
      suppressed,
    });
    // 与 SCU-CLI 一致：只读/隐藏的 ShowHide 插件在发起节点不生效。
    if (parsed.showHide && !readOnly && !suppressed) showHide.push(parsed.showHide);
  }
  fields.sort((a, b) => a.sort - b.sort);
  return {
    appId,
    formId,
    formVersionId,
    fields,
    auth: definition.auth,
    data: definition.data,
    showHide,
  };
}

/** 需要用户填写的字段（占位类型、只读与隐藏字段都不渲染）。 */
export function editableFields(schema: ServiceSchema): ServiceField[] {
  return schema.fields.filter(
    (field) =>
      !PLACEHOLDER_TYPES.has(field.type) &&
      field.type !== 'user' &&
      field.type !== 'dataSource' &&
      !field.readOnly &&
      !field.suppressed,
  );
}

export function placeholderValueFor(type: ServiceFieldType): unknown {
  return ARRAY_PLACEHOLDER_TYPES.has(type) ? [] : '';
}

/** 按 key 取字段（不存在返回 undefined）。 */
export function findField(schema: ServiceSchema, key: string): ServiceField | undefined {
  return schema.fields.find((field) => field.key === key);
}

// ─── 显隐表达式 ──────────────────────────────────────────────────

type Token = { kind: 'value' | 'op' | 'paren' | 'comma'; text: string };

function tokenize(expression: string, valueOf: (key: string) => string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '{') {
      const end = expression.indexOf('}', index);
      if (end < 0) break;
      // 真实表达式写 {p_X}：Go 正则把 "{p_" 当字面量、捕获无前缀 key；
      // 兼容旧的 {X} 形态，仅剥离存在的 p_ 前缀。
      let key = expression.slice(index + 1, end).trim();
      if (key.startsWith('p_')) key = key.slice(2);
      tokens.push({ kind: 'value', text: valueOf(key) });
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = expression.indexOf(char, index + 1);
      const raw = end < 0 ? expression.slice(index + 1) : expression.slice(index + 1, end);
      tokens.push({ kind: 'value', text: raw });
      index = end < 0 ? expression.length : end + 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', text: char });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', text: char });
      index += 1;
      continue;
    }
    const two = expression.slice(index, index + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', text: two });
      index += 2;
      continue;
    }
    if ('=!<>'.includes(char)) {
      tokens.push({ kind: 'op', text: char });
      index += 1;
      continue;
    }
    let word = '';
    while (index < expression.length && /[\w.$\u4e00-\u9fa5]/.test(expression[index]!)) {
      word += expression[index];
      index += 1;
    }
    if (word) tokens.push({ kind: 'value', text: word });
    else index += 1;
  }
  return tokens;
}

// ─── ShowHide 表达式特判（与 SCU-CLI evalShowHideExpression 对齐） ──

const SPECIAL_DATE_CMP_RE =
  /^new Date\(\{p_([A-Za-z0-9_]+)\}\)\s*(<=|>=|<|>)\s*new Date\('([^']+)'\)$/;
const SPECIAL_EMPTY_CMP_RE = /^\{p_([A-Za-z0-9_]+)\}\s*(==|!=)\s*''$/;
const SPECIAL_INDEX_OF_RE = /^\{p_([A-Za-z0-9_]+)\}\.indexOf\(([^)]+)\)\s*(!==-1|==-1)$/;
const SPECIAL_INCLUDES_RE = /^\{p_([A-Za-z0-9_]+)\}\.includes\(([^)]+)\)$/;
const SPECIAL_ARRAY_CMP_RE = /^\{p_([A-Za-z0-9_]+)\}\[0\](?:\.value)?\s*(==|!=)\s*(\S+)$/;

function unquoteExpr(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

/** 宽松解析服务端日期（'2026-08-10'、'2026-08-10T17:10:21' 等），失败返回 null。 */
function parseLooseDate(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(value.trim());
  if (!match) return null;
  const iso = match[2] ? `${match[1]}T${match[2]}` : (match[1] ?? '');
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * 求值 ShowHide 条件表达式；无法解析时按「不命中」处理（字段保持可见）。
 * 先试 SCU-CLI 的方法调用/日期比较形态，再落到通用 tokenizer（括号/&&/||/in）。
 */
export function evaluateCondition(expression: string, valueOf: (key: string) => string): boolean {
  const result = evaluateConditionStrict(expression, valueOf);
  if (result !== null) return result;
  const expr = expression.trim();
  // 无括号的 || 复合：逐段求值，任一段未知即整体不命中（与 Go 一致）。
  if (expr.includes('||') && !expr.includes('(') && !expr.includes(')')) {
    for (const part of expr.split('||')) {
      const hit = evaluateConditionStrict(part, valueOf);
      if (hit === true) return true;
      if (hit === null) return false;
    }
    return false;
  }
  return false;
}

/** 返回 true/false 表示可求值，null 表示形态未支持。 */
function evaluateConditionStrict(
  expression: string,
  valueOf: (key: string) => string,
): boolean | null {
  const expr = expression.trim();
  if (expr === 'true') return true;
  if (expr === 'false') return false;

  const normValue = (key: string): string => {
    const value = valueOf(key);
    return value === null || value === undefined ? '' : String(value).trim();
  };

  let match: RegExpExecArray | null;
  if ((match = SPECIAL_DATE_CMP_RE.exec(expr))) {
    const left = parseLooseDate(normValue(match[1]!));
    const right = parseLooseDate(match[3]!);
    if (left === null || right === null) return null;
    switch (match[2]) {
      case '<=':
        return left <= right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      case '>':
        return left > right;
    }
  }
  if ((match = SPECIAL_EMPTY_CMP_RE.exec(expr))) {
    const empty = normValue(match[1]!) === '';
    return (match[2] === '==') === empty;
  }
  if ((match = SPECIAL_INDEX_OF_RE.exec(expr))) {
    const value = normValue(match[1]!);
    const needle = unquoteExpr(match[2]!);
    const hit = needle !== '' && value.includes(needle);
    return match[3] === '!==-1' ? hit : !hit;
  }
  if ((match = SPECIAL_INCLUDES_RE.exec(expr))) {
    return normValue(match[1]!).includes(unquoteExpr(match[2]!));
  }
  if ((match = SPECIAL_ARRAY_CMP_RE.exec(expr))) {
    const hit = normValue(match[1]!) === unquoteExpr(match[3]!);
    return (match[2] === '==') === hit;
  }

  const tokens = tokenize(expr, valueOf);
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const eat = (value: string): boolean => {
    const token = peek();
    if (token && token.kind !== 'value' && token.text === value) {
      position += 1;
      return true;
    }
    return false;
  };

  const parseFactor = (): boolean => {
    if (eat('(')) {
      const value = parseOr();
      eat(')');
      return value;
    }
    if (eat('!')) return !parseFactor();
    const token = peek();
    if (!token) return false;
    position += 1;
    const left = token.text;
    // 支持 `{key} in ("a","b")` 与 `{key} not in (...)`。
    const next = peek();
    if (next && next.kind === 'value' && (next.text === 'in' || next.text === 'notin')) {
      const negate = next.text === 'notin';
      position += 1;
      const list: string[] = [];
      if (eat('(')) {
        while (peek() && peek()!.text !== ')') {
          const item = peek()!;
          if (item.kind !== 'comma') list.push(item.text);
          position += 1;
        }
        eat(')');
      }
      const matched = list.includes(left);
      return negate ? !matched : matched;
    }
    const op = peek();
    if (op && op.kind === 'op') {
      position += 1;
      const rightToken = peek();
      if (!rightToken) return false;
      position += 1;
      const right = rightToken.text;
      const numeric = Number(left);
      const numericRight = Number(right);
      const bothNumeric = Number.isFinite(numeric) && Number.isFinite(numericRight);
      switch (op.text) {
        case '==':
        case '=':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return bothNumeric ? numeric > numericRight : left > right;
        case '<':
          return bothNumeric ? numeric < numericRight : left < right;
        case '>=':
          return bothNumeric ? numeric >= numericRight : left >= right;
        case '<=':
          return bothNumeric ? numeric <= numericRight : left <= right;
        default:
          return false;
      }
    }
    return left !== '' && left !== 'false' && left !== '0';
  };

  function parseAnd(): boolean {
    let value = parseFactor();
    while (peek() && peek()!.kind === 'op' && peek()!.text === '&&') {
      position += 1;
      const right = parseFactor();
      value = value && right;
    }
    return value;
  }

  function parseOr(): boolean {
    let value = parseAnd();
    while (peek() && peek()!.kind === 'op' && peek()!.text === '||') {
      position += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  }

  try {
    const value = parseOr();
    // 没吃完 token 说明表达式里有不认识的写法：返回 null（按不命中处理）。
    return position >= tokens.length ? value : null;
  } catch {
    return null;
  }
}

export interface ServiceVisibility {
  /** 字段 key → 是否显示。 */
  readonly visible: Readonly<Record<string, boolean>>;
  /** 字段 key → 是否动态必填。 */
  readonly required: Readonly<Record<string, boolean>>;
  /** 隐藏且规则要求清空的字段。 */
  readonly clear: ReadonlySet<string>;
}

/** 按 ShowHide 规则计算显隐与动态必填；未命中任何规则时保持默认可见。 */
export function resolveVisibility(
  schema: ServiceSchema,
  values: Readonly<Record<string, unknown>>,
): ServiceVisibility {
  const visible: Record<string, boolean> = {};
  const required: Record<string, boolean> = {};
  const clear = new Set<string>();
  for (const rule of schema.showHide) {
    for (const [index, condition] of rule.conditions.entries()) {
      // 真实协议里 controls 的 conkey 是条件序号字符串（"0"/"1"…），
      // 与 conditions 按下标配对；兼容旧测试里按条件名索引的形态。
      const control = rule.controls[String(index)] ?? rule.controls[condition.name];
      if (!control) continue;
      const hit = condition.expression
        ? evaluateCondition(condition.expression, (key) => {
            const value = values[key];
            return value === null || value === undefined ? '' : String(value);
          })
        : true;
      if (!hit) continue;
      for (const target of control.targets) {
        if (control.isShow !== undefined) visible[target] = control.isShow;
        if (control.isRequired !== undefined) required[target] = control.isRequired;
        if (control.isShow === false && control.clearWhenHidden) clear.add(target);
      }
    }
  }
  return { visible, required, clear };
}

// ─── 序列化 ──────────────────────────────────────────────────────

const optionName = (field: ServiceField, value: string): string =>
  field.options.find((option) => option.value === value)?.name ?? '';

function isoDateTime(value: unknown): string {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  // 与服务端一致：UTC 的 `YYYY-MM-DDTHH:mm:ss.000Z`。
  return date.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** 单字段提交值（类型感知）。 */
export function serializeFieldValue(field: ServiceField, value: unknown): unknown {
  const empty = value === null || value === undefined || text(value) === '';
  switch (field.type) {
    case 'radio':
    case 'select': {
      if (empty) return '';
      const raw = text(value);
      return { value: raw, name: optionName(field, raw) };
    }
    case 'selectV2': {
      if (empty) return [];
      const raw = text(value);
      return [{ value: raw, name: optionName(field, raw) }];
    }
    case 'checkbox': {
      const list = Array.isArray(value) ? value.map((item) => text(item)) : [];
      return list.map((item) => ({ value: item, name: optionName(field, item) }));
    }
    case 'calendar':
      return isoDateTime(value);
    case 'region': {
      if (!isRecord(value) || Object.keys(value).length === 0) return '';
      return regionToFormData(value);
    }
    case 'file': {
      const list = Array.isArray(value) ? value : [];
      return list.filter(isRecord).map((item) => ({
        name: text(item.name),
        url: text(item.url),
        id: text(item.id),
      }));
    }
    case 'dataSource': {
      if (empty) return '';
      return { list: text(value) };
    }
    default:
      return empty ? '' : text(value);
  }
}

/** Region 提交结构：{province/city/area:{label,value}, details, address}。 */
export function regionToFormData(selection: Record<string, unknown>): Record<string, unknown> {
  const part = (key: string) => {
    const value = selection[key];
    return isRecord(value)
      ? { label: text(value.label), value: text(value.value) }
      : { label: '', value: '' };
  };
  const details = text(selection.details);
  const segments = ['province', 'city', 'area']
    .map((key) => (isRecord(selection[key]) ? text(selection[key].label) : ''))
    .filter(Boolean);
  if (details) segments.push(details);
  return {
    province: part('province'),
    city: part('city'),
    area: part('area'),
    details,
    address: segments.join('/'),
  };
}

/** 预填值：start-data.data 原样带入；calendar 归一为本地输入格式。 */
export function defaultServiceValues(schema: ServiceSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const preset = schema.data[field.key];
    if (preset === undefined || preset === null) continue;
    if (field.type === 'radio' || field.type === 'select' || field.type === 'selectV2') {
      values[field.key] = isRecord(preset) ? text(preset.value) : text(preset);
    } else if (field.type === 'checkbox') {
      values[field.key] = Array.isArray(preset)
        ? preset.map((item) => (isRecord(item) ? text(item.value) : text(item)))
        : [];
    } else if (field.type === 'calendar') {
      const iso = text(preset);
      const date = new Date(iso);
      // 服务端预填是 UTC 时间，转本地后再交给 datetime-local，保证序列化往返一致。
      values[field.key] = Number.isNaN(date.getTime()) ? '' : toLocalInput(date);
    } else if (field.type === 'dataSource') {
      values[field.key] = isRecord(preset) ? text(preset.list) : text(preset);
    } else if (field.type === 'region') {
      values[field.key] = isRecord(preset) ? preset : undefined;
    } else {
      values[field.key] = typeof preset === 'string' || typeof preset === 'number' ? preset : '';
    }
  }
  return values;
}

const padTwo = (value: number): string => String(value).padStart(2, '0');

/** Date → datetime-local 输入格式（YYYY-MM-DDTHH:mm，本地时区）。 */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}T${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

/** Validate 日期顺序校验：返回违反「早于等于」的规则（提交前抛出）。 */
export function dateOrderViolations(
  schema: ServiceSchema,
  values: Readonly<Record<string, unknown>>,
): readonly { firstKey: string; secondKey: string; message: string }[] {
  const violations: { firstKey: string; secondKey: string; message: string }[] = [];
  for (const field of schema.fields) {
    const rule = field.dateRule;
    if (!rule) continue;
    const first = parseLooseDate(text(values[rule.firstKey]));
    const second = parseLooseDate(text(values[rule.secondKey]));
    if (first !== null && second !== null && first > second) {
      violations.push({
        firstKey: rule.firstKey,
        secondKey: rule.secondKey,
        message: rule.message || `${rule.firstKey} 必须早于等于 ${rule.secondKey}`,
      });
    }
  }
  return violations;
}

/** 必填校验：返回缺失字段（含 label，便于直接展示）。 */
export function missingRequiredFields(
  schema: ServiceSchema,
  values: Readonly<Record<string, unknown>>,
): ServiceField[] {
  const { visible, required } = resolveVisibility(schema, values);
  return editableFields(schema).filter((field) => {
    if (visible[field.key] === false) return false;
    const isRequired = required[field.key] ?? field.required;
    if (!isRequired) return false;
    const value = values[field.key];
    if (Array.isArray(value)) return value.length === 0;
    if (isRecord(value)) return Object.keys(value).length === 0;
    return value === null || value === undefined || text(value) === '';
  });
}

/**
 * 组装 form_data：外层以 formId 为键，内层覆盖 auth 中的全部字段。
 * 隐藏/占位字段按类型写空值，DataSource 取数为空时整对省略。
 */
export function buildServiceFormData(
  schema: ServiceSchema,
  values: Readonly<Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const { visible } = resolveVisibility(schema, values);
  const result: Record<string, unknown> = {};
  const omitted = new Set<string>();
  const pairWrites: Record<string, unknown> = {};

  for (const key of Object.keys(schema.auth)) {
    const field = schema.fields.find((item) => item.key === key);
    const type = field?.type ?? fieldTypeFromKey(key);
    const value = values[key];

    if (PLACEHOLDER_TYPES.has(type)) {
      result[key] = placeholderValueFor(type);
      continue;
    }
    if (type === 'dataSource') {
      const name = text(value);
      if (!name) {
        // 取数为空：本字段与配对字段整对省略（与 SCU-CLI 一致）。
        omitted.add(key);
        if (field?.dataSource && !field.dataSource.isSetPlugin && field.dataSource.resultKey)
          omitted.add(field.dataSource.resultKey);
        continue;
      }
      result[key] = { list: name };
      // 配对字段延迟到循环结束后写入，避免被目标字段自身分支覆盖。
      if (field?.dataSource && !field.dataSource.isSetPlugin && field.dataSource.resultKey)
        pairWrites[field.dataSource.resultKey] = name;
      continue;
    }
    if (!field) {
      result[key] = placeholderValueFor(type);
      continue;
    }
    if (field.readOnly || field.suppressed || field.type === 'user') {
      result[key] = serializeFieldValue(field, value);
      continue;
    }
    if (visible[field.key] === false) {
      result[key] = placeholderValueFor(type);
      continue;
    }
    result[key] = serializeFieldValue(field, value);
  }
  Object.assign(result, pairWrites);
  for (const key of omitted) delete result[key];
  return { [schema.formId]: result };
}
