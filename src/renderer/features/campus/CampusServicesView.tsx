import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  CalendarCheck,
  CreditCard,
  DoorOpen,
  FileText,
  GraduationCap,
  ListTree,
  LoaderCircle,
  Megaphone,
  PlugZap,
  Printer,
  Trophy,
  Wifi,
  Wrench,
  RefreshCw,
  Table2,
  Wallet,
} from 'lucide-react';
import type {
  ScuCardHistory,
  ScuCodeName,
  ScuConnectionState,
  ScuExam,
  ScuIdentityState,
  ScuNotice,
  ScuNoticeDetail,
  ScuOption,
  ScuResult,
} from '../../../shared/api';
import type { ScuCloudPrintOptions } from '../../../shared/scu';
import {
  CLASSROOM_PERIODS,
  CLASSROOM_STATUS_LABELS,
  scuBalanceAmount,
  scuBalanceFields,
  scuClassroomBuildings,
  scuClassroomCampuses,
  scuClassroomRows,
  scuClassroomTypeList,
  scuClassRows,
  scuCompletionPlans,
  scuCourseRows,
  scuFitnessSummary,
  scuGradeRows,
  scuGradeSummary,
  scuMoney,
  scuProgramCourse,
  scuProgramRows,
  scuProgramTree,
  scuScheduleItems,
  scuSubjects,
  type ScuClassroomBuilding,
  type ScuClassroomCampus,
  type ScuClassroomStatus,
  type ScuClassroomType,
  type ScuClassRow,
  type ScuCompletionPlan,
  type ScuCourseRow,
  type ScuGradeRow,
  type ScuProgramCourseInfo,
  type ScuProgramRow,
  type ScuScheduleItem,
} from '../../../shared/scu-present';
import { Button } from '../../components/ui/button';
import { DesktopOnlyNotice } from '../../components/ui/desktop-only-notice';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { CcylPanel, PasspointPanel, RepairPanel, ServiceStartCard } from './campus-extra-panels';

type TabId =
  | 'grades'
  | 'exams'
  | 'balance'
  | 'fitness'
  | 'card'
  | 'service'
  | 'ccyl'
  | 'repair'
  | 'net'
  | 'print'
  | 'classroom'
  | 'program'
  | 'schedule'
  | 'notice';

const tabs: readonly { id: TabId; label: string; icon: typeof BookOpen }[] = [
  { id: 'grades', label: '成绩', icon: BookOpen },
  { id: 'exams', label: '考试', icon: CalendarCheck },
  { id: 'balance', label: '电费', icon: Wallet },
  { id: 'fitness', label: '体测', icon: GraduationCap },
  { id: 'card', label: '校园卡', icon: CreditCard },
  { id: 'service', label: '办事大厅', icon: FileText },
  { id: 'ccyl', label: '第二课堂', icon: Trophy },
  { id: 'repair', label: '在线报修', icon: Wrench },
  { id: 'net', label: '无感认证', icon: Wifi },
  { id: 'classroom', label: '空闲教室', icon: DoorOpen },
  { id: 'program', label: '培养方案', icon: ListTree },
  { id: 'schedule', label: '课表查询', icon: Table2 },
  { id: 'notice', label: '通知', icon: Megaphone },
  { id: 'print', label: '云打印', icon: Printer },
];

function ErrorText({ result }: { result: Extract<ScuResult<unknown>, { ok: false }> }) {
  return (
    <div className="rounded-lg border border-red/30 bg-red-tint/40 px-3 py-2 text-sm text-red">
      {result.error}
      {result.auth ? '（请先点击右上角“连接统一认证”）' : ''}
    </div>
  );
}

function findRows(value: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 4 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    const rows = value.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
    return rows.length === value.length ? rows : null;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const rows = findRows(child, depth + 1);
    if (rows) return rows;
  }
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const hiddenColumns = new Set(['id', 'createUser', 'userId', 'user_id']);

function DataTable({ value }: { value: unknown }) {
  const rows = useMemo(() => findRows(value), [value]);
  const columns = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const keys = new Set<string>();
    for (const row of rows.slice(0, 30))
      for (const key of Object.keys(row)) if (!hiddenColumns.has(key)) keys.add(key);
    return [...keys].slice(0, 10);
  }, [rows]);

  if (!rows || columns.length === 0) {
    return (
      <pre className="max-h-[60vh] overflow-auto rounded-lg bg-inset p-3 text-xs text-ink-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <div className="overflow-auto rounded-lg border border-line">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-inset text-left text-xs text-ink-3">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line/70">
              {columns.map((column) => (
                <td key={column} className="max-w-[24rem] truncate px-3 py-2 text-ink-2">
                  {cellText(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * 教务成绩是「按学期分组」的结构（每项含 cjList 课程数组），
 * 直接交给 DataTable 会渲染成一列 JSON。这里摊平成课程行。
 */
function GradesTable({ rows }: { rows: readonly ScuGradeRow[] }) {
  const summary = useMemo(() => scuGradeSummary(rows), [rows]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Metric label="课程" value={String(summary.courses)} />
        <Metric label="学分" value={summary.credits.toFixed(1)} />
        <Metric
          label="加权均分"
          value={summary.average === null ? '—' : summary.average.toFixed(1)}
        />
        <Metric label="平均绩点" value={summary.gpa === null ? '—' : summary.gpa.toFixed(2)} />
      </div>
      <div className="overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="bg-inset text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 font-medium">课程</th>
              <th className="px-3 py-2 text-right font-medium">学分</th>
              <th className="px-3 py-2 text-right font-medium">成绩</th>
              <th className="px-3 py-2 text-right font-medium">绩点</th>
              <th className="px-3 py-2 text-center font-medium">等级</th>
              <th className="px-3 py-2 font-medium">学期</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const failed = row.grade.toUpperCase() === 'F' || (Number(row.score) || 100) < 60;
              return (
                <tr key={`${row.name}-${row.term}-${index}`} className="border-t border-line/70">
                  <td className="max-w-[22rem] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{row.name}</span>
                      {row.attribute && (
                        <span className="shrink-0 rounded bg-inset px-1.5 py-0.5 text-[11px] text-ink-3">
                          {row.attribute}
                        </span>
                      )}
                    </div>
                    {row.english && (
                      <p className="mt-0.5 truncate text-xs text-ink-3">{row.english}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {row.credit || '—'}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-semibold tabular-nums',
                      failed ? 'text-red' : 'text-ink',
                    )}
                  >
                    {row.score || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {row.point || '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-ink-2">{row.grade || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">
                    {row.term || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-inset px-2 py-1 text-ink-3">
      {label}
      <strong className="text-sm font-semibold tabular-nums text-ink">{value}</strong>
    </span>
  );
}

function GradesPanel() {
  const [scheme, setScheme] = useState(false);
  const [result, setResult] = useState<ScuResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (next: boolean) => {
    if (!window.dela) return;
    setBusy(true);
    setResult(await window.dela.scu.grades(next));
    setBusy(false);
  }, []);
  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <Panel
      title="教务成绩"
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-ink-3">
            <input
              type="checkbox"
              checked={scheme}
              onChange={(event) => {
                setScheme(event.target.checked);
                void load(event.target.checked);
              }}
            />
            方案成绩
          </label>
          <Button size="sm" variant="ghost" onClick={() => void load(scheme)} disabled={busy}>
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
          </Button>
        </div>
      }
    >
      {result &&
        (result.ok ? (
          (() => {
            const rows = scuGradeRows(result.data);
            return rows.length > 0 ? (
              <GradesTable rows={rows} />
            ) : (
              <DataTable value={result.data} />
            );
          })()
        ) : (
          <ErrorText result={result} />
        ))}
    </Panel>
  );
}

function ExamsPanel() {
  const [result, setResult] = useState<ScuResult<readonly ScuExam[]> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    setResult(await window.dela.scu.exams());
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="考试安排"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      {result && !result.ok && <ErrorText result={result} />}
      {result?.ok &&
        (result.data.length === 0 ? (
          <p className="text-sm text-ink-3">考表暂无安排。</p>
        ) : (
          <DataTable value={result.data} />
        ))}
    </Panel>
  );
}

function BalanceCard({ value }: { value: unknown }) {
  const amount = scuBalanceAmount(value);
  const fields = scuBalanceFields(value).filter((field) => field.label !== '剩余电量（度）');
  const price = scuMoney((value as { price?: unknown } | null)?.price);
  if (amount === null && fields.length === 0) return <DataTable value={value} />;
  return (
    <div className="rounded-lg border border-line bg-inset/50 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-ink-3">剩余电量</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
            {amount ?? '—'}
            <span className="ml-1 text-sm font-normal text-ink-3">度</span>
          </p>
        </div>
        {price && <p className="text-xs text-ink-3">单价 ¥{price} / 度</p>}
      </div>
      {fields.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-ink-3">{field.label}</dt>
              <dd className="truncate text-ink-2">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function BalancePanel() {
  const [type, setType] = useState<1 | 2>(1);
  const [campuses, setCampuses] = useState<readonly ScuCodeName[]>([]);
  const [buildings, setBuildings] = useState<readonly ScuCodeName[]>([]);
  const [units, setUnits] = useState<readonly ScuCodeName[]>([]);
  const [schoolCode, setSchoolCode] = useState('');
  const [regCode, setRegCode] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [room, setRoom] = useState('');
  const [result, setResult] = useState<ScuResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCampuses = useCallback(async () => {
    if (!window.dela) return;
    const next = await window.dela.scu.balanceCampus();
    if (next.ok) setCampuses(next.data);
    else setResult(next);
  }, []);

  useEffect(() => {
    void loadCampuses();
  }, [loadCampuses]);

  const chooseCampus = async (code: string) => {
    setSchoolCode(code);
    setRegCode('');
    setUnitCode('');
    setBuildings([]);
    setUnits([]);
    if (!code || !window.dela) return;
    const next = await window.dela.scu.balanceBuildings(code);
    if (next.ok) setBuildings(next.data);
    else setResult(next);
  };

  const chooseBuilding = async (code: string) => {
    setRegCode(code);
    setUnitCode('');
    setUnits([]);
    if (!code || !window.dela) return;
    const next = await window.dela.scu.balanceUnits(schoolCode, code);
    if (next.ok) setUnits(next.data);
    else setResult(next);
  };

  const query = async () => {
    if (!window.dela) return;
    setBusy(true);
    setResult(
      await window.dela.scu.balanceQuery({
        type,
        ...(schoolCode ? { schoolCode } : {}),
        ...(regCode ? { regCode } : {}),
        ...(unitCode ? { unitCode } : {}),
        ...(room.trim() ? { room: room.trim() } : {}),
      }),
    );
    setBusy(false);
  };

  return (
    <Panel
      title="宿舍电费"
      actions={
        <Button size="sm" onClick={() => void query()} disabled={busy}>
          {busy ? '查询中…' : '查询余额'}
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          类型
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={type}
            onChange={(event) => setType(event.target.value === '2' ? 2 : 1)}
          >
            <option value={1}>照明电费</option>
            <option value={2}>空调电费</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          校区
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={schoolCode}
            onChange={(event) => void chooseCampus(event.target.value)}
          >
            <option value="">请选择</option>
            {campuses.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name || item.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          楼栋
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={regCode}
            onChange={(event) => void chooseBuilding(event.target.value)}
          >
            <option value="">请选择</option>
            {buildings.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name || item.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          单元
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={unitCode}
            onChange={(event) => setUnitCode(event.target.value)}
          >
            <option value="">请选择</option>
            {units.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name || item.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3 sm:col-span-2">
          房间号（首次查询需填写并绑定）
          <Input
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="如 101"
          />
        </label>
      </div>
      {result && (result.ok ? <BalanceCard value={result.data} /> : <ErrorText result={result} />)}
    </Panel>
  );
}

function FitnessCard({ value }: { value: unknown }) {
  const summary = useMemo(() => scuFitnessSummary(value), [value]);
  if (!summary) return <DataTable value={value} />;
  const gradeTone = (grade: string): string => {
    if (!grade) return 'bg-inset text-ink-3';
    if (/缺项|不及格|未测/.test(grade)) return 'bg-red-tint text-red';
    if (/优秀|良好/.test(grade)) return 'bg-green-tint text-green';
    return 'bg-inset text-ink-2';
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-line bg-inset/50 p-4">
        <div>
          <p className="text-xs text-ink-3">{summary.student || '体测成绩'}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-ink">
              {summary.total || '—'}
            </span>
            <span className="text-xs text-ink-3">总分</span>
            {summary.grade && (
              <span className={cn('rounded px-2 py-0.5 text-xs', gradeTone(summary.grade))}>
                {summary.grade}
              </span>
            )}
          </p>
        </div>
        <div className="text-right text-xs text-ink-3">
          {summary.status && <p>{summary.status}</p>}
          {summary.description && <p className="mt-0.5">{summary.description}</p>}
        </div>
      </div>
      {summary.items.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
            >
              <span className="text-sm text-ink-2">{item.label}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-ink">{item.score || '—'}</span>
                {item.grade && (
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px]', gradeTone(item.grade))}>
                    {item.grade}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FitnessPanel() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [score, setScore] = useState<ScuResult<unknown> | null>(null);
  const [notices, setNotices] = useState<ScuResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const loadScore = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    setScore(await window.dela.scu.fitnessScore(Number(year) || undefined));
    setBusy(false);
  }, [year]);

  const loadNotices = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    setNotices(await window.dela.scu.fitnessNotices());
    setBusy(false);
  }, []);

  useEffect(() => {
    void loadScore();
    void loadNotices();
  }, [loadScore, loadNotices]);

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="体测成绩"
        actions={
          <Button size="sm" onClick={() => void loadScore()} disabled={busy}>
            查询
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <Input className="w-32" value={year} onChange={(event) => setYear(event.target.value)} />
          <span className="text-xs text-ink-3">学年</span>
        </div>
        {score && (score.ok ? <FitnessCard value={score.data} /> : <ErrorText result={score} />)}
      </Panel>
      <Panel
        title="体测通知"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void loadNotices()} disabled={busy}>
            加载
          </Button>
        }
      >
        {notices &&
          (notices.ok ? <DataTable value={notices.data} /> : <ErrorText result={notices} />)}
      </Panel>
    </div>
  );
}

function CardPanel() {
  const [sdate, setSdate] = useState('');
  const [edate, setEdate] = useState('');
  const [result, setResult] = useState<ScuResult<ScuCardHistory> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    setResult(await window.dela.scu.cardTransactions(sdate, edate));
    setBusy(false);
  }, [sdate, edate]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="校园卡交易"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={sdate} onChange={(event) => setSdate(event.target.value)} />
        <span className="text-xs text-ink-3">至</span>
        <Input type="date" value={edate} onChange={(event) => setEdate(event.target.value)} />
        <span className="text-xs text-ink-3">留空则取最近几天</span>
      </div>
      {result && !result.ok && <ErrorText result={result} />}
      {result?.ok && (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-ink-2">
              区间消费 <strong className="text-ink">¥{result.data.totalCost.toFixed(2)}</strong>
            </span>
            <span className="text-ink-2">
              交易笔数 <strong className="text-ink">{result.data.txnCount}</strong>
            </span>
            {result.data.balance !== null && (
              <span className="text-ink-2">
                最新余额 <strong className="text-ink">¥{result.data.balance.toFixed(2)}</strong>
              </span>
            )}
          </div>
          <DataTable value={result.data.transactions} />
        </>
      )}
    </Panel>
  );
}

function ServicePanel() {
  const [status, setStatus] = useState(0);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ScuResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    setResult(await window.dela.scu.serviceApplications(status, page));
    setBusy(false);
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="我的申请"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
          value={status}
          onChange={(event) => {
            setStatus(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={0}>全部</option>
          <option value={1}>进行中 / 草稿</option>
          <option value={3}>已完成</option>
        </select>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          上一页
        </Button>
        <span className="text-xs text-ink-3">第 {page} 页</span>
        <Button size="sm" variant="ghost" onClick={() => setPage((value) => value + 1)}>
          下一页
        </Button>
      </div>
      {result && (result.ok ? <DataTable value={result.data} /> : <ErrorText result={result} />)}
    </Panel>
  );
}

function CloudPrintPanel() {
  const [status, setStatus] = useState<ScuResult<{ ready: boolean }> | null>(null);
  const [jobs, setJobs] = useState<ScuResult<readonly unknown[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [options, setOptions] = useState<ScuCloudPrintOptions>({
    color: 'bw',
    paper: 'a4',
    duplex: 'simplex',
    copies: 1,
    pages: 'all',
  });

  const load = useCallback(async () => {
    if (!window.dela) return;
    setBusy(true);
    const nextStatus = await window.dela.scu.cloudPrintStatus();
    setStatus(nextStatus);
    if (nextStatus.ok) setJobs(await window.dela.scu.cloudPrintJobs());
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!jobs?.ok) return [];
    return jobs.data.map((raw) => {
      const job = (raw ?? {}) as Record<string, unknown>;
      return {
        name: String(job.szJobName ?? job.dwJobId ?? '未命名任务'),
        created: `${String(job.dwCreateDate ?? '')} ${String(job.dwCreateTime ?? '')}`.trim(),
        status: String(job.dwStatus ?? '—'),
        pages: String(job.dwPages ?? '—'),
        copies: String(job.dwCopies ?? '—'),
        fee: String(job.dwFee ?? '—'),
        paper: String(job.szAttribe ?? '—'),
      };
    });
  }, [jobs]);

  return (
    <Panel
      title="图书馆云打印"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      <p className="text-xs text-ink-3">
        上传文件后到馆内终端刷校园卡打印；上传失败时不要直接重传，先到任务列表核对。
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-inset/40 p-2">
        <select
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          onChange={(event) =>
            setOptions((current) => ({ ...current, color: event.target.value as 'bw' | 'color' }))
          }
          value={options.color}
        >
          <option value="bw">黑白</option>
          <option value="color">彩色</option>
        </select>
        <select
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          onChange={(event) =>
            setOptions((current) => ({
              ...current,
              paper: event.target.value as ScuCloudPrintOptions['paper'],
            }))
          }
          value={options.paper}
        >
          <option value="a4">A4</option>
          <option value="a3">A3</option>
          <option value="original">原稿</option>
        </select>
        <select
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          onChange={(event) =>
            setOptions((current) => ({
              ...current,
              duplex: event.target.value as ScuCloudPrintOptions['duplex'],
            }))
          }
          value={options.duplex}
        >
          <option value="simplex">单面</option>
          <option value="long-edge">双面·长边</option>
          <option value="short-edge">双面·短边</option>
        </select>
        <Input
          className="h-8 w-20 text-xs"
          min="1"
          onChange={(event) =>
            setOptions((current) => ({ ...current, copies: Number(event.target.value) || 1 }))
          }
          type="number"
          value={options.copies}
        />
        <Input
          className="h-8 w-24 text-xs"
          onChange={(event) => setOptions((current) => ({ ...current, pages: event.target.value }))}
          placeholder="all 或 2-5"
          value={options.pages}
        />
        <Button
          disabled={uploading || busy}
          onClick={async () => {
            setUploading(true);
            setUploadNotice(null);
            const result = await window.dela!.scu.cloudPrintUpload(options);
            setUploading(false);
            if (!result.ok) {
              setUploadNotice(result.error);
              return;
            }
            const payload = result.data as { message?: string; warning?: string };
            setUploadNotice([payload.message, payload.warning].filter(Boolean).join('；'));
            void load();
          }}
          size="sm"
        >
          {uploading ? <LoaderCircle className="animate-spin" /> : <Printer />}
          选择文件并上传
        </Button>
      </div>
      {uploadNotice ? <p className="text-xs text-ink-3">{uploadNotice}</p> : null}
      {status && !status.ok && <ErrorText result={status} />}
      {status?.ok && <p className="text-sm text-ink-2">会话已建立 · 共 {rows.length} 条任务</p>}
      {jobs && !jobs.ok && <ErrorText result={jobs} />}
      {rows.length > 0 && (
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-inset text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 text-right font-medium">页数</th>
                <th className="px-3 py-2 text-right font-medium">份数</th>
                <th className="px-3 py-2 text-right font-medium">费用</th>
                <th className="px-3 py-2 font-medium">纸张</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.name}-${index}`} className="border-t border-line/70">
                  <td className="max-w-[18rem] truncate px-3 py-2 font-medium text-ink">
                    {row.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">{row.created}</td>
                  <td className="px-3 py-2 text-ink-2">{row.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.pages}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.copies}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.fee}</td>
                  <td className="px-3 py-2 text-xs text-ink-3">{row.paper}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

const CLASSROOM_TONE: Readonly<Record<ScuClassroomStatus, string>> = {
  free: 'bg-green-tint text-green',
  class: 'bg-red-tint text-red',
  exam: 'bg-orange-tint text-orange',
  experiment: 'bg-orange-tint/60 text-orange',
  borrowed: 'bg-inset text-ink-2',
};

function ClassroomPanel() {
  const [campuses, setCampuses] = useState<readonly ScuClassroomCampus[]>([]);
  const [buildings, setBuildings] = useState<readonly ScuClassroomBuilding[]>([]);
  const [types, setTypes] = useState<readonly ScuClassroomType[]>([]);
  const [campusNumber, setCampusNumber] = useState('');
  const [buildingNumber, setBuildingNumber] = useState('');
  const [classroomType, setClassroomType] = useState('');
  const [classroomName, setClassroomName] = useState('');
  const [seatFrom, setSeatFrom] = useState('');
  const [seatTo, setSeatTo] = useState('');
  const [date, setDate] = useState(todayInput);
  const [result, setResult] = useState<ScuResult<unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.dela) return;
    void (async () => {
      const next = await window.dela!.scu.classroomIndex();
      if (next.ok) {
        setCampuses(scuClassroomCampuses(next.data));
        setBuildings(scuClassroomBuildings(next.data));
      } else {
        setResult(next);
      }
    })();
  }, []);

  const campusBuildings = useMemo(
    () => buildings.filter((item) => !campusNumber || item.campusNumber === campusNumber),
    [buildings, campusNumber],
  );
  const currentCampus = campuses.find((item) => item.number === campusNumber);
  const currentBuilding = campusBuildings.find((item) => item.number === buildingNumber);

  const chooseBuilding = async (number: string) => {
    setBuildingNumber(number);
    setClassroomType('');
    setTypes([]);
    if (!window.dela) return;
    const building = campusBuildings.find((item) => item.number === number);
    if (!building || !currentCampus) return;
    const next = await window.dela.scu.classroomTypes({
      campusNumber: building.campusNumber,
      buildingNumber: building.number,
      campusName: currentCampus.name,
      buildingName: building.name,
    });
    if (next.ok) setTypes(scuClassroomTypeList(next.data));
    else setResult(next);
  };

  const rows = useMemo(() => (result?.ok ? scuClassroomRows(result.data) : []), [result]);

  const query = async () => {
    if (!window.dela || !currentCampus || !currentBuilding) return;
    setBusy(true);
    setResult(
      await window.dela.scu.classroomAvailability({
        campusNumber: currentBuilding.campusNumber,
        buildingNumber: currentBuilding.number,
        classroomType,
        classroomName: classroomName.trim(),
        seatFrom,
        seatTo,
        date,
      }),
    );
    setBusy(false);
  };

  return (
    <Panel
      title="空闲教室"
      actions={
        <Button
          size="sm"
          onClick={() => void query()}
          disabled={busy || !campusNumber || !buildingNumber}
        >
          {busy ? '查询中…' : '查询占用'}
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          校区
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={campusNumber}
            onChange={(event) => {
              setCampusNumber(event.target.value);
              setBuildingNumber('');
              setTypes([]);
              setResult(null);
            }}
          >
            <option value="">请选择</option>
            {campuses.map((item) => (
              <option key={item.number} value={item.number}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          教学楼
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={buildingNumber}
            onChange={(event) => void chooseBuilding(event.target.value)}
            disabled={!campusNumber}
          >
            <option value="">请选择</option>
            {campusBuildings.map((item) => (
              <option key={item.number} value={item.number}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          教室类型
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={classroomType}
            onChange={(event) => setClassroomType(event.target.value)}
          >
            <option value="">全部</option>
            {types.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          日期
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          教室名称（可选）
          <Input
            value={classroomName}
            onChange={(event) => setClassroomName(event.target.value)}
            placeholder="如 A101"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          座位数范围（可选）
          <div className="flex items-center gap-2">
            <Input
              value={seatFrom}
              onChange={(event) => setSeatFrom(event.target.value)}
              placeholder="下限"
            />
            <span className="text-ink-3">–</span>
            <Input
              value={seatTo}
              onChange={(event) => setSeatTo(event.target.value)}
              placeholder="上限"
            />
          </div>
        </label>
      </div>

      {result && !result.ok && <ErrorText result={result} />}
      {result?.ok && rows.length === 0 && <p className="text-sm text-ink-3">该条件下没有教室。</p>}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
            <span>图例：</span>
            {(['free', 'class', 'exam', 'experiment', 'borrowed'] as const).map((status) => (
              <span key={status} className="flex items-center gap-1">
                <span className={cn('inline-block size-3 rounded-sm', CLASSROOM_TONE[status])} />
                {CLASSROOM_STATUS_LABELS[status]}
              </span>
            ))}
          </div>
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead className="bg-inset text-left text-xs text-ink-3">
                <tr>
                  <th className="sticky left-0 bg-inset px-3 py-2 font-medium">教室</th>
                  <th className="px-3 py-2 text-right font-medium">座位</th>
                  {Array.from({ length: CLASSROOM_PERIODS }, (_, index) => (
                    <th key={index} className="px-1 py-2 text-center font-medium">
                      {index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-t border-line/70">
                    <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 font-medium text-ink">
                      {row.name}
                      {row.remark && <span className="ml-2 text-xs text-ink-3">{row.remark}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-3">
                      {row.seats ?? '—'}
                    </td>
                    {row.statuses.map((status, index) => (
                      <td key={index} className="px-1 py-1 text-center">
                        <span
                          className={cn(
                            'inline-flex h-6 w-7 items-center justify-center rounded text-[11px]',
                            CLASSROOM_TONE[status],
                          )}
                          title={CLASSROOM_STATUS_LABELS[status]}
                        >
                          {status === 'free' ? '' : CLASSROOM_STATUS_LABELS[status][0]}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function ProgramSearch() {
  const [colleges, setColleges] = useState<readonly ScuOption[]>([]);
  const [grades, setGrades] = useState<readonly ScuOption[]>([]);
  const [college, setCollege] = useState('');
  const [grade, setGrade] = useState('');
  const [rows, setRows] = useState<readonly ScuProgramRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<{
    title: string;
    nodes: ReturnType<typeof scuProgramTree>;
  } | null>(null);
  const [course, setCourse] = useState<ScuProgramCourseInfo | null>(null);

  useEffect(() => {
    if (!window.dela) return;
    void (async () => {
      const [nextColleges, nextGrades] = await Promise.all([
        window.dela!.scu.programColleges(),
        window.dela!.scu.programGrades(),
      ]);
      if (nextColleges.ok) setColleges(nextColleges.data);
      else setError(nextColleges.error);
      if (nextGrades.ok) setGrades(nextGrades.data);
    })();
  }, []);

  const search = async () => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    setCourse(null);
    const result = await window.dela.scu.programSearch({
      ...(college ? { college } : {}),
      ...(grade ? { grade } : {}),
    });
    if (result.ok) setRows(scuProgramRows(result.data));
    else setError(result.error);
    setBusy(false);
  };

  const openDetail = async (row: ScuProgramRow) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.programDetail(row.id);
    if (result.ok) {
      const title =
        (result.data as { title?: unknown } | null)?.title?.toString() || row.name || row.id;
      setDetail({ title, nodes: scuProgramTree(result.data) });
      setCourse(null);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const openCourse = async (path: string) => {
    if (!window.dela) return;
    setBusy(true);
    const result = await window.dela.scu.programCourse(path);
    if (result.ok) setCourse(scuProgramCourse(result.data));
    else setError(result.error);
    setBusy(false);
  };

  if (course) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs text-ink-3 hover:text-ink"
          onClick={() => setCourse(null)}
        >
          ← 返回方案
        </button>
        <div className="rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">{course.title}</h3>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {course.fields.map((field) => (
              <div key={field.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-ink-3">{field.label}</dt>
                <dd className="truncate text-ink-2">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }

  if (detail) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs text-ink-3 hover:text-ink"
          onClick={() => setDetail(null)}
        >
          ← 返回搜索结果
        </button>
        <h3 className="text-sm font-semibold text-ink">{detail.title}</h3>
        {detail.nodes.length === 0 ? (
          <p className="text-sm text-ink-3">该方案没有课程树数据。</p>
        ) : (
          <ul className="max-h-[60vh] overflow-auto rounded-lg border border-line py-1 text-sm">
            {detail.nodes.map((node) => (
              <li
                key={node.id || `${node.name}-${node.depth}`}
                style={{ paddingLeft: `${12 + node.depth * 16}px` }}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-1.5',
                  node.hasChildren ? 'font-medium text-ink' : 'text-ink-2',
                )}
              >
                <span className="truncate">
                  {node.hasChildren ? '▸ ' : '· '}
                  {node.name}
                </span>
                {node.path && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-ink-3 hover:text-ink"
                    onClick={() => void openCourse(node.path)}
                    disabled={busy}
                  >
                    课程详情
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          学院
          <select
            className="h-9 min-w-40 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={college}
            onChange={(event) => setCollege(event.target.value)}
          >
            <option value="">全部</option>
            {colleges.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          年级
          <select
            className="h-9 min-w-28 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={grade}
            onChange={(event) => setGrade(event.target.value)}
          >
            <option value="">全部</option>
            {grades.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => void search()} disabled={busy}>
          {busy ? '查询中…' : '搜索方案'}
        </Button>
      </div>
      {error && <p className="text-sm text-red">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-ink-3">没有匹配的培养方案。</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-inset text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">方案名称</th>
                <th className="px-3 py-2 font-medium">学院</th>
                <th className="px-3 py-2 font-medium">年级</th>
                <th className="px-3 py-2 font-medium">方案号</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.name}`} className="border-t border-line/70">
                  <td className="max-w-[24rem] truncate px-3 py-2 text-ink">{row.name || '—'}</td>
                  <td className="px-3 py-2 text-ink-2">{row.college || '—'}</td>
                  <td className="px-3 py-2 text-ink-2">{row.grade || '—'}</td>
                  <td className="px-3 py-2 text-xs text-ink-3">{row.id || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-ink-3 hover:text-ink"
                      onClick={() => void openDetail(row)}
                      disabled={busy || !row.id}
                    >
                      查看课程树
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanCompletionPanel() {
  const [plans, setPlans] = useState<readonly ScuCompletionPlan[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.planCompletion();
    if (result.ok) {
      const next = scuCompletionPlans(result.data);
      setPlans(next);
      setSelected(next[0]?.id ?? '');
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const plan = plans?.find((item) => item.id === selected) ?? plans?.[0];
  const percent =
    plan && plan.required > 0 ? Math.min(100, Math.round((plan.earned / plan.required) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void load()} disabled={busy}>
          {busy ? '加载中…' : plans ? '刷新学分完成' : '加载学分完成'}
        </Button>
        {plans && plans.length > 1 && (
          <select
            className="h-9 min-w-48 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {plans.map((item, index) => (
              <option key={`${item.id}-${index}`} value={item.id}>
                {item.name || `方案 ${index + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="text-sm text-red">{error}</p>}
      {plan && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-2">{plan.name || '培养方案'}</span>
              <span className="tabular-nums text-ink">
                {plan.earned.toFixed(1)} / {plan.required.toFixed(1)} 学分
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-inset">
              <div className="h-full rounded bg-green" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-line py-1 text-sm">
            {plan.rows.map((row, index) => (
              <div
                key={`${row.name}-${index}`}
                style={{ paddingLeft: `${12 + row.depth * 16}px` }}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-1.5',
                  row.isCourse ? 'text-ink-2' : 'font-medium text-ink',
                )}
              >
                <span className="truncate">
                  {row.isCourse ? '· ' : '▸ '}
                  {row.name}
                  {row.credits && (
                    <span className="ml-1 text-xs text-ink-3">{row.credits} 学分</span>
                  )}
                  {row.term && <span className="ml-1 text-xs text-ink-3">{row.term}</span>}
                </span>
                <span className="shrink-0 text-xs">
                  {row.isCourse ? (
                    <span className={cn(row.completed ? 'text-green' : 'text-ink-3')}>
                      {row.grade || (row.completed ? '已修' : '未修')}
                    </span>
                  ) : (
                    <span className="tabular-nums text-ink-3">
                      {row.earned ?? 0} / {row.required ?? 0}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgramPanel() {
  const [mode, setMode] = useState<'search' | 'completion'>('search');
  return (
    <Panel
      title="培养方案"
      actions={
        <div className="flex gap-1 rounded-md bg-inset p-1 text-xs">
          {(
            [
              ['search', '方案查询'],
              ['completion', '学分完成'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(
                'rounded px-2 py-1 transition-colors',
                mode === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
              )}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {mode === 'search' ? <ProgramSearch /> : <PlanCompletionPanel />}
    </Panel>
  );
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function ScheduleList({ items }: { items: readonly ScuScheduleItem[] }) {
  const groups = useMemo(() => {
    const map = new Map<number, ScuScheduleItem[]>();
    for (const item of items) {
      if (item.weekday < 1 || item.weekday > 7) continue;
      const list = map.get(item.weekday) ?? [];
      list.push(item);
      map.set(item.weekday, list);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [items]);

  if (groups.length === 0) return <p className="text-sm text-ink-3">该学期没有排课记录。</p>;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([weekday, list]) => (
        <div key={weekday} className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-ink-3">{WEEKDAY_LABELS[weekday - 1]}</h4>
          <div className="flex flex-col gap-1.5">
            {list.map((item, index) => (
              <div
                key={`${item.courseCode}-${item.startPeriod}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <span className="font-medium text-ink">
                  第 {item.startPeriod}
                  {item.duration > 1 ? `-${item.startPeriod + item.duration - 1}` : ''} 节
                </span>
                <span className="text-ink-2">{item.name || '未命名课程'}</span>
                {item.teacher && <span className="text-xs text-ink-3">{item.teacher}</span>}
                {(item.building || item.room) && (
                  <span className="text-xs text-ink-3">
                    {item.campus} {item.building}
                    {item.room}
                  </span>
                )}
                {item.weeks && <span className="text-xs text-ink-3">{item.weeks}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleInquiryPanel() {
  const [mode, setMode] = useState<'class' | 'course'>('class');
  return (
    <Panel
      title="班级 / 课程课表"
      actions={
        <div className="flex gap-1 rounded-md bg-inset p-1 text-xs">
          {(
            [
              ['class', '按班级'],
              ['course', '按课程'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(
                'rounded px-2 py-1 transition-colors',
                mode === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
              )}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {mode === 'class' ? <ClassScheduleInquiry /> : <CourseScheduleInquiry />}
    </Panel>
  );
}

function ClassScheduleInquiry() {
  const [options, setOptions] = useState<{
    semesters: readonly ScuOption[];
    grades: readonly ScuOption[];
    departments: readonly ScuOption[];
  }>({ semesters: [], grades: [], departments: [] });
  const [subjects, setSubjects] = useState<readonly ScuOption[]>([]);
  const [semester, setSemester] = useState('');
  const [grade, setGrade] = useState('');
  const [department, setDepartment] = useState('');
  const [subject, setSubject] = useState('');
  const [classNum, setClassNum] = useState('');
  const [rows, setRows] = useState<readonly ScuClassRow[] | null>(null);
  const [schedule, setSchedule] = useState<{
    title: string;
    items: ReturnType<typeof scuScheduleItems>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.dela) return;
    void (async () => {
      const result = await window.dela!.scu.classOptions();
      if (result.ok) {
        const value = result.data as {
          semesters?: readonly ScuOption[];
          grades?: readonly ScuOption[];
          departments?: readonly ScuOption[];
        };
        setOptions({
          semesters: value.semesters ?? [],
          grades: value.grades ?? [],
          departments: value.departments ?? [],
        });
      } else {
        setError(result.error);
      }
    })();
  }, []);

  const chooseDepartment = async (value: string) => {
    setDepartment(value);
    setSubject('');
    setSubjects([]);
    if (!window.dela || !value) return;
    const result = await window.dela.scu.classSubjects(value);
    if (result.ok) setSubjects(scuSubjects(result.data));
    else setError(result.error);
  };

  const search = async () => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    setSchedule(null);
    const result = await window.dela.scu.classList({
      ...(semester ? { plan: semester } : {}),
      ...(grade ? { year: grade } : {}),
      ...(department ? { department } : {}),
      ...(subject ? { subject } : {}),
      ...(classNum.trim() ? { classNum: classNum.trim() } : {}),
    });
    if (result.ok) setRows(scuClassRows(result.data));
    else setError(result.error);
    setBusy(false);
  };

  const open = async (row: ScuClassRow) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.classSchedule(row.planCode, row.classCode);
    if (result.ok) {
      setSchedule({
        title: `${row.name}${row.planName ? ` · ${row.planName}` : ''}`,
        items: scuScheduleItems(result.data),
      });
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  if (schedule) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs text-ink-3 hover:text-ink"
          onClick={() => setSchedule(null)}
        >
          ← 返回班级列表
        </button>
        <h3 className="text-sm font-semibold text-ink">{schedule.title}</h3>
        <ScheduleList items={schedule.items} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          学期
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
          >
            <option value="">全部</option>
            {options.semesters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          年级
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={grade}
            onChange={(event) => setGrade(event.target.value)}
          >
            <option value="">全部</option>
            {options.grades.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          院系
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={department}
            onChange={(event) => void chooseDepartment(event.target.value)}
          >
            <option value="">全部</option>
            {options.departments.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          专业
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={subjects.length === 0}
          >
            <option value="">全部</option>
            {subjects.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          班级号（可选）
          <Input
            value={classNum}
            onChange={(event) => setClassNum(event.target.value)}
            placeholder="如 242010801"
          />
        </label>
        <div className="flex items-end">
          <Button size="sm" onClick={() => void search()} disabled={busy}>
            {busy ? '查询中…' : '搜索班级'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-ink-3">没有匹配的班级。</p>}
      {rows && rows.length > 0 && (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-inset text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">班级</th>
                <th className="px-3 py-2 font-medium">院系</th>
                <th className="px-3 py-2 font-medium">专业</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.planCode}-${row.classCode}`} className="border-t border-line/70">
                  <td className="max-w-[20rem] truncate px-3 py-2 text-ink">
                    {row.name}
                    {row.planName && (
                      <span className="ml-2 text-xs text-ink-3">{row.planName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{row.department || '—'}</td>
                  <td className="px-3 py-2 text-ink-2">{row.subject || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-ink-3 hover:text-ink"
                      onClick={() => void open(row)}
                      disabled={busy}
                    >
                      查看课表
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CourseScheduleInquiry() {
  const [options, setOptions] = useState<{
    semesters: readonly ScuOption[];
    departments: readonly ScuOption[];
    categories: readonly ScuOption[];
  }>({ semesters: [], departments: [], categories: [] });
  const [semester, setSemester] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<readonly ScuCourseRow[] | null>(null);
  const [schedule, setSchedule] = useState<{
    title: string;
    items: ReturnType<typeof scuScheduleItems>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.dela) return;
    void (async () => {
      const result = await window.dela!.scu.courseOptions();
      if (result.ok) {
        const value = result.data as {
          semesters?: readonly ScuOption[];
          departments?: readonly ScuOption[];
          categories?: readonly ScuOption[];
        };
        setOptions({
          semesters: value.semesters ?? [],
          departments: value.departments ?? [],
          categories: value.categories ?? [],
        });
      } else {
        setError(result.error);
      }
    })();
  }, []);

  const search = async () => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    setSchedule(null);
    const result = await window.dela.scu.courseSearch({
      ...(semester ? { semester } : {}),
      ...(department ? { department } : {}),
      ...(category ? { category } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (result.ok) setRows(scuCourseRows(result.data));
    else setError(result.error);
    setBusy(false);
  };

  const open = async (row: ScuCourseRow) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.courseSchedule(
      row.planCode || semester,
      row.courseCode,
      row.courseSeq,
    );
    if (result.ok) {
      setSchedule({
        title: `${row.name}（${row.courseSeq}）${row.teachers ? ` · ${row.teachers}` : ''}`,
        items: scuScheduleItems(result.data),
      });
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  if (schedule) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs text-ink-3 hover:text-ink"
          onClick={() => setSchedule(null)}
        >
          ← 返回课程列表
        </button>
        <h3 className="text-sm font-semibold text-ink">{schedule.title}</h3>
        <ScheduleList items={schedule.items} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          学期
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
          >
            <option value="">全部</option>
            {options.semesters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          开课院系
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">全部</option>
            {options.departments.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          课程类别
          <select
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">全部</option>
            {options.categories.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3 sm:col-span-2">
          课程名称（可选）
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="如 编译原理"
          />
        </label>
        <div className="flex items-end">
          <Button size="sm" onClick={() => void search()} disabled={busy}>
            {busy ? '查询中…' : '搜索课程'}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-ink-3">没有匹配的课程。</p>}
      {rows && rows.length > 0 && (
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead className="bg-inset text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 font-medium">课程</th>
                <th className="px-3 py-2 text-right font-medium">学分</th>
                <th className="px-3 py-2 font-medium">类别</th>
                <th className="px-3 py-2 font-medium">教师</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.planCode}-${row.courseCode}-${row.courseSeq}`}
                  className="border-t border-line/70"
                >
                  <td className="max-w-[22rem] truncate px-3 py-2 text-ink">
                    {row.name}
                    <span className="ml-2 text-xs text-ink-3">{row.courseSeq}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {row.credits || '—'}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{row.category || '—'}</td>
                  <td className="px-3 py-2 text-ink-2">{row.teachers || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="text-xs text-ink-3 hover:text-ink"
                      onClick={() => void open(row)}
                      disabled={busy}
                    >
                      查看排课
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NoticePanel() {
  const [notices, setNotices] = useState<readonly ScuNotice[] | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<ScuNoticeDetail | null>(null);
  const [body, setBody] = useState<ScuResult<ScuNoticeDetail> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: number) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.jwcNotices(next);
    if (result.ok) {
      setNotices(result.data);
      setPage(next);
    } else {
      setError(result.error);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const open = async (notice: ScuNotice) => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    const result = await window.dela.scu.jwcNotice(notice.url);
    if (result.ok) {
      setDetail(result.data);
      setBody(result);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  if (detail) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs text-ink-3 hover:text-ink"
          onClick={() => {
            setDetail(null);
            setBody(null);
          }}
        >
          ← 返回通知列表
        </button>
        <div className="rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">{detail.title || '通知详情'}</h3>
          {detail.date && <p className="mt-1 text-xs text-ink-3">发布时间：{detail.date}</p>}
          <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-2">
            {detail.content || '（正文为空）'}
          </pre>
        </div>
        {body && !body.ok && <ErrorText result={body} />}
      </div>
    );
  }

  return (
    <Panel
      title="教务处通知"
      actions={
        <Button size="sm" variant="ghost" onClick={() => void load(page)} disabled={busy}>
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </Button>
      }
    >
      {error && <p className="text-sm text-red">{error}</p>}
      {!notices && <p className="text-sm text-ink-3">正在加载教务处通知…</p>}
      {notices && (
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {notices.map((notice) => (
            <li key={notice.id}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-hover-2"
                onClick={() => void open(notice)}
                disabled={busy}
              >
                <span className="truncate text-sm text-ink">{notice.title}</span>
                <span className="shrink-0 text-xs text-ink-3">{notice.date}</span>
              </button>
            </li>
          ))}
          {notices.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">没有通知。</li>}
        </ul>
      )}
      <div className="flex items-center justify-end gap-2 text-xs text-ink-3">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || page <= 1}
          onClick={() => void load(page - 1)}
        >
          上一页
        </Button>
        <span>第 {page} 页</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load(page + 1)}>
          下一页
        </Button>
      </div>
    </Panel>
  );
}

export function CampusServicesView() {
  if (!window.dela) {
    return (
      <DesktopOnlyNotice
        description="统一身份认证会话与校园服务请求只在桌面端主进程内完成。"
        title="校园服务仅在明远湖桌面端可用"
      />
    );
  }
  return <DesktopCampusServices />;
}

function DesktopCampusServices() {
  const [tab, setTab] = useState<TabId>('grades');
  const [state, setState] = useState<ScuConnectionState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ScuIdentityState | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    if (!window.dela) return;
    setState(await window.dela.scu.state());
  }, []);

  const refreshIdentity = useCallback(async () => {
    if (!window.dela) return;
    setIdentity(await window.dela.scu.identityState());
  }, []);

  useEffect(() => {
    void refreshState();
    void refreshIdentity();
  }, [refreshState, refreshIdentity]);

  const connect = async () => {
    if (!window.dela) return;
    setConnectError(null);
    setConnecting(true);
    const result = await window.dela.scu.connect();
    setConnecting(false);
    if (!result.ok) {
      setConnectError(result.error);
      setState({ connected: false, principal: null, name: null });
      return;
    }
    await refreshState();
  };

  const loginToken = async () => {
    if (!window.dela) return;
    setTokenError(null);
    setTokenBusy(true);
    try {
      const result = await window.dela.scu.identityLoginAuto({
        username: username.trim(),
        password,
      });
      setIdentity(result);
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTokenError(message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim());
    } finally {
      setTokenBusy(false);
    }
  };

  const logoutToken = async () => {
    if (!window.dela) return;
    setIdentity(await window.dela.scu.identityLogout());
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">校园服务</h1>
          <p className="mt-1 text-sm text-ink-3">
            教务、电费、体测、校园卡与办事大厅数据来自四川大学各业务系统。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-ink-3">
            {state?.connected ? (
              <>
                <p className="text-ink-2">
                  {state.name ?? '已连接'}
                  {state.principal ? ` · ${state.principal}` : ''}
                </p>
                <p>统一身份认证会话有效</p>
              </>
            ) : (
              <p>尚未连接统一身份认证</p>
            )}
          </div>
          <Button size="sm" onClick={() => void connect()} disabled={connecting}>
            <PlugZap className="size-4" />
            {connecting ? '登录中…' : state?.connected ? '重新登录' : '连接统一认证'}
          </Button>
        </div>
      </header>

      {connectError && (
        <p className="text-sm text-red" role="alert">
          {connectError}
        </p>
      )}

      <section className="rounded-lg border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">统一认证密码登录</p>
            <p className="mt-0.5 text-xs text-ink-3">
              学号 + 密码换取访问令牌，验证码由本地 OCR
              识别；密码只在本次登录使用，不写入磁盘与日志。
            </p>
          </div>
          {identity?.connected ? (
            <div className="flex items-center gap-3 text-xs text-ink-3">
              <span className="text-ink-2">
                已登录{identity.principal ? ` · ${identity.principal}` : ''}
                {identity.expiresAt
                  ? ` · 有效至 ${new Date(identity.expiresAt).toLocaleTimeString()}`
                  : ''}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void logoutToken()}>
                退出
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Input
                className="w-40"
                placeholder="学号"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Input
                className="w-44"
                type="password"
                placeholder="统一认证密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !tokenBusy) void loginToken();
                }}
              />
              <Button
                size="sm"
                disabled={tokenBusy || !username.trim() || !password}
                onClick={() => void loginToken()}
              >
                {tokenBusy ? '登录中…' : '密码登录'}
              </Button>
            </div>
          )}
        </div>
        {tokenError && (
          <p className="mt-2 text-xs text-red" role="alert">
            {tokenError}
          </p>
        )}
      </section>

      <nav className="flex flex-wrap gap-1 rounded-lg bg-inset p-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === item.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
              )}
              onClick={() => setTab(item.id)}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0">
        {tab === 'grades' && <GradesPanel />}
        {tab === 'exams' && <ExamsPanel />}
        {tab === 'balance' && <BalancePanel />}
        {tab === 'fitness' && <FitnessPanel />}
        {tab === 'card' && <CardPanel />}
        {tab === 'service' && <ServicePanel />}
        {tab === 'service' && <ServiceStartCard />}
        {tab === 'ccyl' && <CcylPanel />}
        {tab === 'repair' && <RepairPanel />}
        {tab === 'net' && <PasspointPanel />}
        {tab === 'classroom' && <ClassroomPanel />}
        {tab === 'program' && <ProgramPanel />}
        {tab === 'schedule' && <ScheduleInquiryPanel />}
        {tab === 'notice' && <NoticePanel />}
        {tab === 'print' && <CloudPrintPanel />}
      </div>
    </div>
  );
}
