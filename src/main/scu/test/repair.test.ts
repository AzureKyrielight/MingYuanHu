// 报修/无感认证/云打印的纯函数：项目树查找、MAC 归一、打印设置与任务差集。
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));

import { findRepairProjectLeaf, type RepairProject } from '../repair';
import { normalizeMac } from '../passpoint';
import { newCloudPrintJobs, prepareCloudPrintOptions } from '../cloudprint';

const tree: RepairProject[] = [
  {
    id: '1',
    name: '水电维修',
    value: '',
    children: [
      { id: '11', name: '水龙头', value: '101', children: [] },
      { id: '12', name: '灯管', value: '102', children: [] },
    ],
  },
  {
    id: '2',
    name: '门窗维修',
    value: '',
    children: [{ id: '21', name: '门锁', value: '201', children: [] }],
  },
];

describe('findRepairProjectLeaf', () => {
  it('返回叶子与「大类/项目」全名', () => {
    expect(findRepairProjectLeaf(tree, '101')).toEqual({
      leaf: { id: '11', name: '水龙头', value: '101', children: [] },
      label: '水电维修/水龙头',
    });
  });

  it('也接受叶子 id', () => {
    expect(findRepairProjectLeaf(tree, '21')?.label).toBe('门窗维修/门锁');
  });

  it('找不到返回 null', () => {
    expect(findRepairProjectLeaf(tree, '999')).toBeNull();
  });
});

describe('normalizeMac', () => {
  it('接受冒号、空格与大写，统一成小写短横线', () => {
    expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('aa-bb-cc-dd-ee-ff');
    expect(normalizeMac('aa bb cc dd ee ff')).toBe('aa-bb-cc-dd-ee-ff');
  });

  it('长度不对时报错', () => {
    expect(() => normalizeMac('aa:bb')).toThrow(/MAC/);
  });
});

describe('prepareCloudPrintOptions', () => {
  it('把用户选项翻译成打印站协议值', () => {
    expect(
      prepareCloudPrintOptions({
        color: 'color',
        paper: 'a3',
        duplex: 'long-edge',
        copies: 3,
        pages: '2-5',
      }).fields,
    ).toEqual({
      dwColor: '2',
      dwPaperId: '8',
      dwDuplex: '2',
      dwCopies: '3',
      dwFrom: '2',
      dwTo: '5',
    });
  });

  it('pages=all 用 0/0 表示全篇', () => {
    expect(
      prepareCloudPrintOptions({
        color: 'bw',
        paper: 'a4',
        duplex: 'simplex',
        copies: 1,
        pages: 'all',
      }).fields,
    ).toMatchObject({ dwFrom: '0', dwTo: '0' });
  });

  it('非法设置直接拒绝', () => {
    expect(() =>
      prepareCloudPrintOptions({
        color: 'bw',
        paper: 'a4',
        duplex: 'simplex',
        copies: 0,
        pages: 'all',
      }),
    ).toThrow(/份数/);
    expect(() =>
      prepareCloudPrintOptions({
        color: 'bw',
        paper: 'a4',
        duplex: 'simplex',
        copies: 1,
        pages: '5-2',
      }),
    ).toThrow(/结束页/);
  });
});

describe('newCloudPrintJobs', () => {
  it('只按任务 ID 做差集', () => {
    const before = [{ dwJobId: 1, szJobName: 'a.pdf' }];
    const after = [
      { dwJobId: 1, szJobName: 'a.pdf' },
      { dwJobId: 2, szJobName: 'a.pdf' },
      { dwJobId: 3, szJobName: 'another.pdf' },
    ];
    expect(newCloudPrintJobs(before, after)).toEqual([
      { dwJobId: 2, szJobName: 'a.pdf' },
      { dwJobId: 3, szJobName: 'another.pdf' },
    ]);
  });
});
