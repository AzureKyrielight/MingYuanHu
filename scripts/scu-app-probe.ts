// 应用内 SCU 冒烟探针（Electron）：复用真实 userData 与校园分区跑各子系统只读接口。
// 不提交写操作，不改服务端数据。
// 凭据只从环境变量读取（SCU_USERNAME / SCU_PASSWORD），token 缺失时自动登录。
// 构建：node scripts/run-ts-smoke.ts scu-app-probe --build-only
// 运行：node -e "require('node:child_process').spawnSync(require('electron'),['--no-sandbox','.tools/scu-app-probe.cjs'],{stdio:'inherit',env:process.env})"
import { app } from 'electron';
import { join } from 'node:path';
import { cookieNames } from '../src/main/scu/client';
import {
  bindIdentitySession,
  identityState,
  loginWithPasswordAuto,
} from '../src/main/scu/identity';
import { searchCcylActivities, signUpCcylActivity, cancelCcylSignUp } from '../src/main/scu/ccyl';
import { fetchRepairAddresses, fetchRepairAreaTree } from '../src/main/scu/repair';
import { fetchPasspointDevices, fetchPasspointUser } from '../src/main/scu/passpoint';
import { fetchCloudPrintStatus } from '../src/main/scu/cloudprint';
import { fetchMyApplications, fetchServiceRegionTree } from '../src/main/scu/service';
import { fetchFitnessNotices } from '../src/main/scu/fitness';
import { fetchCampus as fetchPayAppCampus } from '../src/main/scu/payapp';

app.setPath('userData', join(process.env.APPDATA ?? '', 'mingyuanhu'));
// 无感认证会用隐藏窗口预热，窗口销毁不能把探针进程一起带走。
app.on('window-all-closed', () => {});

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
    if (process.env.SCU_WRITE_SMOKE) {
      await step('ccyl.candidates', async () => {
        const rows = await searchCcylActivities({ pageSize: 5 });
        for (const row of rows.slice(0, 5)) {
          console.log(`PROBE candidate ${JSON.stringify(row).slice(0, 300)}`);
        }
        return rows.length;
      });
      const target = process.env.SCU_CCYL_ACTIVITY_ID;
      if (target) {
        await step('ccyl.signup', async () => {
          const result = await signUpCcylActivity(target, process.env.SCU_CCYL_SCORE_TYPE ?? '');
          console.log(`PROBE signup ${JSON.stringify(result)}`);
          const cancelled = await cancelCcylSignUp(target);
          console.log(`PROBE cancel ${JSON.stringify(cancelled)}`);
          return 'signed-up-and-cancelled';
        });
      }
    }
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.log(`PROBE fatal ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  });
