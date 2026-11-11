import { contextBridge } from 'electron';
import { version } from '../../package.json';
import type { DelaApi } from '../shared/api';
import { cache } from './cache';
import { chat } from './chat';
import { consent } from './consent';
import { backup } from './backup';
import { llm } from './llm';
import { capabilityApi as capability } from './capabilities';
import { layout } from './layout';
import { mail } from './mail';
import { notifications } from './notifications';
import { packages } from './packages';
import { remotes } from './remotes';
import { search } from './search';
import { scu } from './scu';
import { session, sidechat } from './session';
import { settings } from './settings';
import { timetable } from './timetable';
import { todo } from './todo';
import { terminal } from './terminal';
import { update } from './update';
import { windowApi } from './window';
import { workspace } from './workspace';

contextBridge.exposeInMainWorld('dela', {
  platform: process.platform,
  scu,
  version,
  updatedOnLaunch: process.argv.includes('--dela-updated'),
  todo,
  terminal,
  remotes,
  search,
  notifications,
  window: windowApi,
  settings,
  consent,
  backup,
  cache,
  llm,
  chat,
  mail,
  timetable,
  workspace,
  session,
  sidechat,
  layout,
  capability,
  packages,
  update,
} satisfies DelaApi);
