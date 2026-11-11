import { describe, expect, it, vi } from 'vitest';
import { CampusAuthError } from '../../campus';
import { decodeCloudPrintBody, mapCloudPrintJob } from '../cloudprint';

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {},
  session: {},
  net: { request: vi.fn() },
}));

describe('decodeCloudPrintBody', () => {
  it('code=0 时返回包层', () => {
    expect(decodeCloudPrintBody('{"code":0,"result":[],"SessionId":"abc"}')).toMatchObject({
      code: 0,
      SessionId: 'abc',
    });
  });

  it('code=4 视为会话失效', () => {
    expect(() => decodeCloudPrintBody('{"code":4}')).toThrow(CampusAuthError);
  });

  it('缺少 code 不能当作成功', () => {
    expect(() => decodeCloudPrintBody('{"result":[]}')).toThrow('缺少有效的 code 字段');
    expect(() => decodeCloudPrintBody('<html>')).toThrow('无法识别的数据');
  });

  it('其他 code 带出服务端文案', () => {
    expect(() => decodeCloudPrintBody('{"code":7,"message":"余额不足"}')).toThrow(
      '余额不足（code=7）',
    );
  });
});

describe('mapCloudPrintJob', () => {
  it('只保留白名单字段并解析纸张明细', () => {
    const job = mapCloudPrintJob({
      dwJobId: 42,
      szJobName: '论文.pdf',
      dwStatus: '已打印',
      dwFee: '0.20',
      szPaperDetail: '{"dwPaperId":9}',
      dwUserName: '张三',
      szCardNo: '123456',
    });
    expect(job).toEqual({
      dwJobId: 42,
      szJobName: '论文.pdf',
      dwStatus: '已打印',
      dwFee: '0.20',
      szPaperDetail: { dwPaperId: 9 },
    });
    expect(job).not.toHaveProperty('dwUserName');
    expect(job).not.toHaveProperty('szCardNo');
  });

  it('纸张明细不是 JSON 时保留原文', () => {
    expect(mapCloudPrintJob({ szPaperDetail: 'A4 双面' }).szPaperDetail).toBe('A4 双面');
  });

  it('非对象输入返回空对象', () => {
    expect(mapCloudPrintJob(null)).toEqual({});
    expect(mapCloudPrintJob('x')).toEqual({});
  });
});
