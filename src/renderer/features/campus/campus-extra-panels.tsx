/**
 * 校园服务的扩展面板：办事大厅动态表单、第二课堂、在线报修、无感认证、云打印上传。
 * 与 CampusServicesView 共用同一套视觉语言（Panel 结构在本地重建，避免循环依赖）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  FileUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';

interface ServiceField {
  key: string;
  type: string;
  label: string;
  options: { value: string; name: string }[];
  hint: string;
  required: boolean;
  readOnly: boolean;
  suppressed: boolean;
  maxCount: number;
}

interface ServiceSchema {
  formId: string;
  fields: ServiceField[];
  appId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface/60 p-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-md border border-red/30 bg-red-tint/40 px-3 py-2 text-xs text-red"
      role="alert"
    >
      {message}
    </p>
  );
}

// ─── 办事大厅动态表单 ────────────────────────────────────────────

const SKIP_TYPES = new Set([
  'text',
  'image',
  'table',
  'showHide',
  'validate',
  'variate',
  'conversion',
]);

export function ServiceStartCard() {
  const [appId, setAppId] = useState('');
  const [schema, setSchema] = useState<ServiceSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [attachments, setAttachments] = useState<
    Record<string, { name: string; url: string; id: string }[]>
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!appId.trim()) {
      setError('请填写事项 ID（来自办事大厅事项页地址栏的 id）');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.dela!.scu.serviceForm(appId.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const view = result.data as { schema: ServiceSchema; values: Record<string, unknown> };
      setSchema(view.schema);
      setValues(view.values ?? {});
      setAttachments({});
      setMessage(`已读取表单：${view.schema.fields.length} 个字段`);
    } finally {
      setBusy(false);
    }
  };

  const setValue = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }));

  const pickFiles = async (field: ServiceField) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.dela!.scu.serviceAttach(appId.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const uploaded = (result.data as { name: string; url: string; id: string }[]).slice();
      setAttachments((current) => ({
        ...current,
        [field.key]: [...(current[field.key] ?? []), ...uploaded].slice(0, field.maxCount),
      }));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const merged: Record<string, unknown> = { ...values };
      for (const [key, list] of Object.entries(attachments)) merged[key] = list;
      const result = await window.dela!.scu.serviceSubmit(appId.trim(), merged);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage('提交成功，可在「我的申请」里查看进度');
    } finally {
      setBusy(false);
    }
  };

  const fields = useMemo(
    () =>
      (schema?.fields ?? []).filter(
        (field) => !SKIP_TYPES.has(field.type) && !field.readOnly && !field.suppressed,
      ),
    [schema],
  );

  return (
    <Section
      title="发起事项（动态表单）"
      actions={
        <Button disabled={busy} onClick={() => void load()} size="sm" variant="secondary">
          {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          读取表单
        </Button>
      }
    >
      <div className="flex gap-2">
        <Input
          placeholder="事项 ID，例如 1234"
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
        />
        <Button disabled={busy} onClick={() => void submit()} size="sm">
          <Send />
          提交
        </Button>
      </div>
      <ErrorLine message={error} />
      {message ? <p className="text-xs text-ink-3">{message}</p> : null}
      {fields.length > 0 ? (
        <div className="grid gap-3">
          {fields.map((field) => (
            <label className="grid gap-1 text-13" key={field.key}>
              <span className="text-ink-2">
                {field.label || field.key}
                {field.required ? <span className="ml-0.5 text-red">*</span> : null}
              </span>
              {renderField(field, values[field.key], attachments[field.key], (value) =>
                setValue(field.key, value),
              )}
              {field.type === 'file' ? (
                <div className="flex items-center gap-2">
                  <Button
                    disabled={busy || (attachments[field.key]?.length ?? 0) >= field.maxCount}
                    onClick={() => void pickFiles(field)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <FileUp />
                    上传附件
                  </Button>
                  <span className="text-xs text-ink-3">
                    {attachments[field.key]?.map((item) => item.name).join('、') ||
                      `最多 ${field.maxCount} 个`}
                  </span>
                </div>
              ) : null}
              {field.hint ? <span className="text-xs text-ink-3">{field.hint}</span> : null}
            </label>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function renderField(
  field: ServiceField,
  value: unknown,
  files: { name: string }[] | undefined,
  onChange: (value: unknown) => void,
) {
  switch (field.type) {
    case 'radio':
      return (
        <div className="flex flex-wrap gap-3">
          {field.options.map((option) => (
            <label className="flex items-center gap-1.5 text-13" key={option.value}>
              <input
                checked={textOf(value) === option.value}
                name={field.key}
                onChange={() => onChange(option.value)}
                type="radio"
              />
              {option.name}
            </label>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <div className="flex flex-wrap gap-3">
          {field.options.map((option) => {
            const list = Array.isArray(value) ? value.map(textOf) : [];
            return (
              <label className="flex items-center gap-1.5 text-13" key={option.value}>
                <input
                  checked={list.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...list, option.value]
                        : list.filter((item) => item !== option.value),
                    )
                  }
                  type="checkbox"
                />
                {option.name}
              </label>
            );
          })}
        </div>
      );
    case 'select':
    case 'selectV2':
      return (
        <select
          className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
          onChange={(event) => onChange(event.target.value)}
          value={textOf(value)}
        >
          <option value="">请选择</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.name}
            </option>
          ))}
        </select>
      );
    case 'calendar':
      return (
        <Input
          onChange={(event) => onChange(event.target.value)}
          type="datetime-local"
          value={textOf(value)}
        />
      );
    case 'file':
      return (
        <span className="text-xs text-ink-3">
          {files?.length ? `已上传 ${files.length} 个` : '尚未选择文件'}
        </span>
      );
    case 'multiInput':
      return (
        <textarea
          className="min-h-20 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          onChange={(event) => onChange(event.target.value)}
          value={textOf(value)}
        />
      );
    default:
      return <Input onChange={(event) => onChange(event.target.value)} value={textOf(value)} />;
  }
}

// ─── 第二课堂 ────────────────────────────────────────────────────

interface CcylActivityRow {
  id: string;
  libraryId: string;
  name: string;
  org: string;
  time: string;
  status: string;
}

function mapCcylActivity(raw: unknown): CcylActivityRow {
  const value = isRecord(raw) ? raw : {};
  const activity = isRecord(value.activity) ? value.activity : value;
  return {
    id: textOf(activity.id) || textOf(value.activityId),
    libraryId: textOf(activity.activityLibraryId) || textOf(value.activityLibraryId),
    name: textOf(activity.name) || textOf(activity.title) || '未命名活动',
    org: textOf(activity.orgName) || textOf(activity.organizationName),
    time: textOf(activity.startTime) || textOf(activity.activityTime),
    status: textOf(value.status) || textOf(activity.status),
  };
}

export function CcylPanel() {
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<CcylActivityRow[]>([]);
  const [mode, setMode] = useState<'search' | 'mine' | 'credit'>('search');
  const [credits, setCredits] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'credit') {
        const result = await window.dela!.scu.ccylCredits(1);
        if (!result.ok) setError(result.error);
        else setCredits((result.data as unknown[]).filter(isRecord));
        return;
      }
      const result =
        mode === 'mine'
          ? await window.dela!.scu.ccylMine(1)
          : await window.dela!.scu.ccylSearch({ name: keyword, page: 1 });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((result.data as unknown[]).map(mapCcylActivity));
    } finally {
      setBusy(false);
    }
  }, [keyword, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const signUp = async (row: CcylActivityRow) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let scoreType = '';
      const types = await window.dela!.scu.ccylScoreTypes(row.libraryId || row.id);
      if (types.ok && Array.isArray(types.data) && types.data.length > 0) {
        const first = types.data[0];
        scoreType = textOf(isRecord(first) ? (first.value ?? first.code ?? first.id) : first);
      }
      const result = await window.dela!.scu.ccylSignUp(row.id, scoreType);
      if (!result.ok) setError(result.error);
      else {
        setNotice(`已报名：${row.name}`);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="第二课堂"
      actions={
        <Button disabled={busy} onClick={() => void load()} size="sm" variant="ghost">
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
          onChange={(event) => setMode(event.target.value as typeof mode)}
          value={mode}
        >
          <option value="search">活动库</option>
          <option value="mine">我参与的</option>
          <option value="credit">学分</option>
        </select>
        {mode === 'search' ? (
          <>
            <Input
              className="max-w-60"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="活动名称"
              value={keyword}
            />
            <Button onClick={() => void load()} size="sm" variant="secondary">
              搜索
            </Button>
          </>
        ) : null}
      </div>
      <ErrorLine message={error} />
      {notice ? <p className="text-xs text-green">{notice}</p> : null}
      {mode === 'credit' ? (
        <ul className="divide-y text-13">
          {credits.map((item, index) => (
            <li className="flex justify-between gap-3 py-2" key={`${textOf(item.id)}-${index}`}>
              <span className="truncate">
                {textOf(item.name) || textOf(item.activityName) || '学分记录'}
              </span>
              <span className="shrink-0 text-ink-3">
                {textOf(item.score) || textOf(item.credit) || ''}
              </span>
            </li>
          ))}
          {credits.length === 0 && !busy ? <li className="py-2 text-ink-3">暂无记录</li> : null}
        </ul>
      ) : (
        <ul className="divide-y text-13">
          {rows.map((row) => (
            <li className="flex items-center justify-between gap-3 py-2" key={row.id}>
              <div className="min-w-0">
                <p className="truncate">{row.name}</p>
                <p className="truncate text-xs text-ink-3">
                  {[row.org, row.time, row.status].filter(Boolean).join(' · ')}
                </p>
              </div>
              {mode === 'search' ? (
                <Button disabled={busy || !row.id} onClick={() => void signUp(row)} size="sm">
                  报名
                </Button>
              ) : (
                <Button
                  disabled={busy || !row.id}
                  onClick={() =>
                    void window.dela!.scu.ccylCancel(row.id).then((result) => {
                      if (!result.ok) setError(result.error);
                      else void load();
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  取消
                </Button>
              )}
            </li>
          ))}
          {rows.length === 0 && !busy ? <li className="py-2 text-ink-3">暂无活动</li> : null}
        </ul>
      )}
    </Section>
  );
}

// ─── 在线报修 ────────────────────────────────────────────────────

interface RepairAddress {
  id: string;
  areaId: string;
  areaName: string;
  addressDetail: string;
  phone: string;
  userId: string;
}

interface RepairLeaf {
  value: string;
  label: string;
}

function flattenProjects(nodes: unknown[], prefix = ''): RepairLeaf[] {
  const out: RepairLeaf[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const name = textOf(node.name);
    const label = prefix ? `${prefix}/${name}` : name;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length > 0) out.push(...flattenProjects(children, label));
    else out.push({ value: textOf(node.value) || textOf(node.id), label });
  }
  return out;
}

export function RepairPanel() {
  const [addresses, setAddresses] = useState<RepairAddress[]>([]);
  const [addressId, setAddressId] = useState('');
  const [projects, setProjects] = useState<RepairLeaf[]>([]);
  const [projectId, setProjectId] = useState('');
  const [content, setContent] = useState('');
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [allowAbsent, setAllowAbsent] = useState(false);
  const [tickets, setTickets] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.dela!.scu.repairAddresses();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const list = (result.data as unknown[]).map((item) => {
        const value = isRecord(item) ? item : {};
        return {
          id: textOf(value.id),
          areaId: textOf(value.areaId),
          areaName: textOf(value.areaName),
          addressDetail: textOf(value.addressDetail),
          phone: textOf(value.phone),
          userId: textOf(value.userId),
        };
      });
      setAddresses(list);
      if (list[0]) setAddressId(list[0].id);
      const userId = list[0]?.userId;
      if (userId) {
        const ticketsResult = await window.dela!.scu.repairTickets(userId);
        if (ticketsResult.ok)
          setTickets((ticketsResult.data as unknown[]).filter(isRecord).slice(0, 10));
      }
      const dateResult = await window.dela!.scu.repairBookDates();
      if (dateResult.ok) setDates((dateResult.data as string[]) ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const address = addresses.find((item) => item.id === addressId);
    if (!address) return;
    void window.dela!.scu.repairProjects(address.areaId).then((result) => {
      if (result.ok) setProjects(flattenProjects((result.data as unknown[]) ?? []));
    });
  }, [addressId, addresses]);

  useEffect(() => {
    if (!bookDate) {
      setTimes([]);
      return;
    }
    void window.dela!.scu.repairBookTimes(bookDate).then((result) => {
      if (result.ok) setTimes((result.data as string[]) ?? []);
    });
  }, [bookDate]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.dela!.scu.repairSubmit({
        addressId,
        projectId,
        content,
        bookDate: bookDate || undefined,
        bookTime: bookTime || undefined,
        allowAbsent,
        images,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice('报修单已提交');
      setContent('');
      setImages([]);
      setProjectId('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="在线报修"
      actions={
        <Button disabled={busy} onClick={() => void load()} size="sm" variant="ghost">
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-13">
          报修地址
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            onChange={(event) => setAddressId(event.target.value)}
            value={addressId}
          >
            <option value="">请选择</option>
            {addresses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.areaName} {item.addressDetail}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-13">
          维修项目
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            <option value="">请选择</option>
            {projects.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-13">
          故障描述
          <textarea
            className="min-h-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-13">
            预约日期（可选）
            <select
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
              onChange={(event) => {
                setBookDate(event.target.value);
                setBookTime('');
              }}
              value={bookDate}
            >
              <option value="">不预约</option>
              {dates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-13">
            时段
            <select
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
              disabled={!bookDate}
              onChange={(event) => setBookTime(event.target.value)}
              value={bookTime}
            >
              <option value="">不指定</option>
              {times.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-13">
            <input
              checked={allowAbsent}
              onChange={(event) => setAllowAbsent(event.target.checked)}
              type="checkbox"
            />
            无人时允许上门
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || images.length >= 3}
            onClick={() =>
              void window.dela!.scu.repairPickImages().then((result) => {
                if (!result.ok) setError(result.error);
                else setImages((result.data as string[]) ?? []);
              })
            }
            size="sm"
            variant="secondary"
          >
            <FileUp />
            现场照片（{images.length}/3）
          </Button>
          <Button disabled={busy} onClick={() => void submit()} size="sm">
            <Send />
            提交报修
          </Button>
          <Button
            disabled={busy}
            onClick={() => void window.dela!.scu.repairBookTimes(bookDate || '').then(() => load())}
            size="sm"
            variant="ghost"
          >
            <CalendarClock />
            刷新可预约
          </Button>
        </div>
        <ErrorLine message={error} />
        {notice ? <p className="text-xs text-green">{notice}</p> : null}
        {tickets.length > 0 ? (
          <div className="grid gap-1">
            <p className="text-xs font-medium text-ink-3">最近工单</p>
            <ul className="divide-y text-13">
              {tickets.map((ticket, index) => (
                <li
                  className="flex items-center justify-between gap-2 py-1.5"
                  key={`${textOf(ticket.id)}-${index}`}
                >
                  <span className="truncate">
                    {textOf(ticket.content) || textOf(ticket.address) || '报修单'}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{textOf(ticket.status)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

// ─── 无感认证 ────────────────────────────────────────────────────

interface PasspointDeviceRow {
  mac: string;
  expireAt: string;
  serviceName: string;
  online: boolean;
}

export function PasspointPanel() {
  const [devices, setDevices] = useState<PasspointDeviceRow[]>([]);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [mac, setMac] = useState('');
  const [days, setDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [list, profile] = await Promise.all([
        window.dela!.scu.passpointDevices(),
        window.dela!.scu.passpointUser(),
      ]);
      if (!list.ok) setError(list.error);
      else
        setDevices(
          (list.data as unknown[]).map((item) => {
            const value = isRecord(item) ? item : {};
            return {
              mac: textOf(value.mac),
              expireAt: textOf(value.expireAt),
              serviceName: textOf(value.serviceName),
              online: value.online === true,
            };
          }),
        );
      if (profile.ok && isRecord(profile.data)) setUser(profile.data);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.dela!.scu.passpointAdd({
        mac,
        expireDays: Number(days) || 0,
      });
      if (!result.ok) setError(result.error);
      else {
        setNotice('已添加设备');
        setMac('');
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="校园网无感认证"
      actions={
        <Button disabled={busy} onClick={() => void load()} size="sm" variant="ghost">
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      {user ? (
        <p className="text-xs text-ink-3">
          {[textOf(user.userName), textOf(user.groupName), textOf(user.mobile)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-13">
          设备 MAC
          <Input
            className="w-52"
            onChange={(event) => setMac(event.target.value)}
            placeholder="aa-bb-cc-dd-ee-ff"
            value={mac}
          />
        </label>
        <label className="grid gap-1 text-13">
          有效期（天）
          <Input
            className="w-24"
            onChange={(event) => setDays(event.target.value)}
            type="number"
            value={days}
          />
        </label>
        <Button disabled={busy || !mac.trim()} onClick={() => void add()} size="sm">
          <Plus />
          添加
        </Button>
      </div>
      <ErrorLine message={error} />
      {notice ? <p className="text-xs text-green">{notice}</p> : null}
      <ul className="divide-y text-13">
        {devices.map((device) => (
          <li className="flex items-center justify-between gap-3 py-2" key={device.mac}>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-xs">
                {device.online ? <Wifi className="size-3 text-green" /> : null}
                {device.mac}
              </p>
              <p className="text-xs text-ink-3">
                {[
                  device.serviceName || '校园网',
                  device.expireAt ? `到期 ${device.expireAt}` : '长期有效',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Button
              aria-label={`删除 ${device.mac}`}
              disabled={busy}
              onClick={() =>
                void window.dela!.scu.passpointCancel(device.mac).then((result) => {
                  if (!result.ok) setError(result.error);
                  else void load();
                })
              }
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {devices.length === 0 && !busy ? <li className="py-2 text-ink-3">暂无已绑定设备</li> : null}
      </ul>
    </Section>
  );
}
