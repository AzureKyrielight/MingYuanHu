// 应用内 SCU 冒烟探针（Electron）：复用真实 userData 与校园分区跑各子系统只读接口。
// 不提交写操作，不改服务端数据。
// 凭据只从环境变量读取（SCU_USERNAME / SCU_PASSWORD），token 缺失时自动登录。
// 构建：node scripts/run-ts-smoke.ts scu-app-probe --build-only
// 运行：node -e "require('node:child_process').spawnSync(require('electron'),['--no-sandbox','.tools/scu-app-probe.cjs'],{stdio:'inherit',env:process.env})"
import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cookieNames } from '../src/main/scu/client';
import {
  bindIdentitySession,
  identityState,
  loginWithPasswordAuto,
} from '../src/main/scu/identity';
import {
  ccylActivityLibrary,
  ccylActivityScoreTypes,
  searchCcylActivities,
  signUpCcylActivity,
  cancelCcylSignUp,
} from '../src/main/scu/ccyl';
import {
  fetchRepairAddresses,
  fetchRepairAreaTree,
  fetchRepairProjects,
  fetchRepairTickets,
  submitRepair,
  withdrawRepair,
  type RepairProject,
} from '../src/main/scu/repair';
import { fetchPasspointDevices, fetchPasspointUser } from '../src/main/scu/passpoint';
import {
  fetchCloudPrintJobs,
  fetchCloudPrintStatus,
  uploadCloudPrint,
} from '../src/main/scu/cloudprint';
import { fetchMyApplications, fetchServiceRegionTree } from '../src/main/scu/service';
import { fetchFitnessNotices } from '../src/main/scu/fitness';
import { fetchCampus as fetchPayAppCampus } from '../src/main/scu/payapp';

app.setPath('userData', join(process.env.APPDATA ?? '', 'mingyuanhu'));
// 无感认证会用隐藏窗口预热，窗口销毁不能把探针进程一起带走。
app.on('window-all-closed', () => {});

/** 单页 PDF，仅用于云打印上传冒烟。 */
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 700 Td (print smoke) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`,
  'utf8',
);

function textField(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const raw = (value as Record<string, unknown>)[key];
  return raw === null || raw === undefined ? '' : String(raw);
}

async function ensureLogin(): Promise<void> {
  if (identityState().connected) return;
  await loginWithPasswordAuto({
    username: process.env.SCU_USERNAME ?? '',
    password: process.env.SCU_PASSWORD ?? '',
  });
  console.log('PROBE login-ok');
}

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    console.log(`PROBE ok ${name} ${JSON.stringify(value)?.slice(0, 160) ?? 'undefined'}`);
  } catch (error) {
    console.log(`PROBE fail ${name} ${error instanceof Error ? error.message : String(error)}`);
  }
}

app
  .whenReady()
  .then(async () => {
    try {
      await ensureLogin();
    } catch (error) {
      console.log(`PROBE login-failed ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
    console.log(`PROBE identity ${JSON.stringify(identityState())}`);
    await step('bind', () => bindIdentitySession());
    await step(
      'service.applications',
      async () => JSON.stringify(await fetchMyApplications()).length,
    );
    await step('service.regions', async () => (await fetchServiceRegionTree()).length);
    await step('ccyl.search', async () => (await searchCcylActivities({})).length);
    await step('repair.addresses', async () => (await fetchRepairAddresses()).length);
    await step('repair.areas', async () => (await fetchRepairAreaTree()).length);
    await step('passpoint.devices', async () => (await fetchPasspointDevices()).length);
    await step('passpoint.user', () => fetchPasspointUser());
    await step('cloudprint.status', () => fetchCloudPrintStatus());
    await step('fitness.notices', () => fetchFitnessNotices());
    await step('payapp.campus', async () => (await fetchPayAppCampus()).length);
    console.log(`PROBE cookies id=${await cookieNames('id.scu.edu.cn')}`);

    // 可逆写操作冒烟：第二课堂报名 → 立即取消。默认只看候选，确认后才真正提交。
    if (process.env.SCU_WRITE_SMOKE === 'inspect') {
      await step('inspect.ccyl', async () => {
        const rows = await searchCcylActivities({ pageSize: 12 });
        for (const row of rows) {
          const library = await ccylActivityLibrary(row.activityLibraryId);
          if (library.activities.length === 0) continue;
          console.log(`PROBE library ${row.activityLibraryId} ${String(row.name).trim()}`);
          for (const activity of library.activities.slice(0, 4)) {
            console.log(`PROBE activity ${JSON.stringify(activity).slice(0, 600)}`);
          }
          const scores = await ccylActivityScoreTypes(row.activityLibraryId);
          console.log(`PROBE scoreTypes ${JSON.stringify(scores).slice(0, 300)}`);
          return `found:${row.activityLibraryId}`;
        }
        return 'no-active-library';
      });
      await step('inspect.repair', async () => {
        const addresses = await fetchRepairAddresses();
        const first = addresses[0];
        if (!first) return 'no-address';
        console.log(`PROBE address ${JSON.stringify(first)}`);
        const projects = await fetchRepairProjects(first.areaId);
        const leaves: { path: string; value: string }[] = [];
        const walk = (
          nodes: readonly { value: string; name: string; children: readonly unknown[] }[],
          path: string[],
        ): void => {
          for (const node of nodes) {
            const next = [...path, node.name || node.value];
            if (node.children.length === 0)
              leaves.push({ path: next.join(' / '), value: node.value });
            else walk(node.children as never, next);
          }
        };
        walk(projects as never, []);
        for (const leaf of leaves.slice(0, 12)) {
          console.log(`PROBE leaf ${leaf.value} ${leaf.path}`);
        }
        return leaves.length;
      });
    }
    if (process.env.SCU_WRITE_SMOKE === 'cleanup' || process.env.SCU_WRITE_SMOKE === '1') {
      await step('repair.cleanup', async () => {
        const addresses = await fetchRepairAddresses();
        const userId = addresses[0]?.userId ?? '';
        const open = (await fetchRepairTickets(userId)).filter(
          (ticket) => ticket.content.includes('接口联调测试') && !ticket.status.includes('已撤回'),
        );
        for (const ticket of open) {
          await withdrawRepair(ticket.id).catch((error: unknown) => {
            console.log(
              `PROBE repair cleanup ${ticket.id} fail ${error instanceof Error ? error.message : String(error)}`,
            );
          });
          console.log(`PROBE repair cleanup ${ticket.id} done`);
        }
        const after = await fetchRepairTickets(userId);
        console.log(
          `PROBE repair openTestLeft=${
            after.filter(
              (ticket) =>
                ticket.content.includes('接口联调测试') && !ticket.status.includes('已撤回'),
            ).length
          } total=${after.length}`,
        );
        return `cleaned:${open.length}`;
      });
      await step('cloudprint.jobs', async () => {
        const jobs = await fetchCloudPrintJobs();
        for (const job of jobs.slice(0, 20)) {
          console.log(`PROBE job ${JSON.stringify(job).slice(0, 200)}`);
        }
        return jobs.length;
      });
    }
    if (process.env.SCU_WRITE_SMOKE === '1') {
      await step('ccyl.signup-cancel', async () => {
        const now = Date.now();
        const rows = await searchCcylActivities({ pageSize: 40 });
        for (const row of rows) {
          const library = await ccylActivityLibrary(row.activityLibraryId);
          if (library.activities.length === 0) continue;
          const scores = await ccylActivityScoreTypes(row.activityLibraryId);
          const scoreType = textField(scores[0], 'code');
          for (const activity of library.activities) {
            const start = Date.parse(textField(activity, 'enrollStartTime'));
            const end = Date.parse(textField(activity, 'enrollEndTime'));
            if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
            if (now < start || now > end) continue;
            const activityId = textField(activity, 'activityId');
            if (!activityId) continue;
            console.log(
              `PROBE picking ${String(row.name).trim()} / ${textField(activity, 'activityName')} score=${scoreType}`,
            );
            await signUpCcylActivity(activityId, scoreType);
            console.log('PROBE signup ok');
            await cancelCcylSignUp(activityId);
            console.log('PROBE cancel ok');
            return { activityId, scoreType };
          }
        }
        return 'no-open-enrollment';
      });

      await step('repair.submit-withdraw', async () => {
        const addresses = await fetchRepairAddresses();
        const address = addresses[0];
        if (!address) return 'no-address';
        const projects = await fetchRepairProjects(address.areaId);
        let leafValue = '';
        const walk = (nodes: readonly RepairProject[]): void => {
          for (const node of nodes) {
            if (node.children.length > 0) walk(node.children);
            else if (!leafValue && node.value) leafValue = node.value;
          }
        };
        walk(projects);
        if (!leafValue) return 'no-project-leaf';
        console.log(`PROBE repair tree ${JSON.stringify(projects).slice(0, 500)}`);
        const user = await fetchPasspointUser();
        // 报修列表按子系统自己的 userId 过滤（地址上带的就是它），不是学号。
        const userId = address.userId || user?.userId || '';
        const before = await fetchRepairTickets(userId);
        const isOpenTest = (ticket: { content: string; status: string }): boolean =>
          ticket.content.includes('接口联调测试') && !ticket.status.includes('已撤回');
        const known = new Set(before.map((ticket) => ticket.id));
        const submitted = await submitRepair({
          addressId: address.id,
          projectId: leafValue,
          content: '【接口联调测试】提交后立即撤回，无需处理',
          realname: user?.userName ?? '',
        });
        let created: typeof before = [];
        for (let attempt = 0; attempt < 5 && created.length === 0; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
          const listed = await fetchRepairTickets(userId);
          created = listed.filter((ticket) => !known.has(ticket.id) && isOpenTest(ticket));
        }
        console.log(`PROBE repair submitted=${submitted.submitted} created=${created.length}`);
        for (const ticket of created) {
          await withdrawRepair(ticket.id);
        }
        const final = await fetchRepairTickets(userId);
        console.log(
          `PROBE repair openTestLeft=${final.filter(isOpenTest).length} remaining=${final.length}`,
        );
        return { created: created.map((ticket) => ticket.id) };
      });

      await step('cloudprint.upload', async () => {
        const file = join('.tools', 'print-smoke.pdf');
        writeFileSync(file, MINIMAL_PDF);
        const before = await fetchCloudPrintJobs();
        const upload = await uploadCloudPrint(file, {
          color: 'bw',
          paper: 'a4',
          duplex: 'simplex',
          copies: 1,
          pages: 'all',
        });
        console.log(
          `PROBE upload status=${upload.status} fee=${upload.fee} jobs=${JSON.stringify(upload.jobs).slice(0, 200)}`,
        );
        return { before: before.length, fileName: upload.fileName };
      });
    }
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.log(`PROBE fatal ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  });
