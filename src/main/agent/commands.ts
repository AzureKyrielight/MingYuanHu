import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { academicTools } from './domain/academic';
import { mailTools } from './domain/mail';
import { scuTools } from './domain/scu';
import { timetableTools } from './domain/timetable';
import { todoTools } from './domain/todo';
import { workspaceTools } from './domain/workspace';
import { readResourceTool } from './domain/read-resource';
import { prepareDocumentResource, releaseDocumentResource } from '../resources';
import { resourceRefSchema } from '../../shared/resources';
import { tool, ToolError } from './domain/shared';
import type { AgentTool } from './domain/shared';

// 这些是 shell 的业务命令，不常驻模型工具表；复用应用已有的缓存、登录与操作边界。
const commandDomains = [
  {
    name: 'scu',
    description:
      '查询川大教务成绩/考表/学期/空闲教室/培养方案/班级课表/课程课表、电费余额、体测、校园卡与办事大厅申请',
    commands: scuTools,
  },
  { name: 'mail', description: '检索邮件、读取附件与准备邮件草稿', commands: mailTools },
  {
    name: 'timetable',
    description: '查询课表与日程，同步课表、创建或删除日程',
    commands: timetableTools,
  },
  { name: 'todo', description: '查询与管理待办', commands: todoTools },
  {
    name: 'academic',
    description: '按学校格式把论文草稿渲染成 DOCX，并维护封面个人信息',
    commands: academicTools,
  },
  {
    name: 'workspace',
    description: '管理项目与导入附件；普通文件用 read/write/edit/shell',
    commands: workspaceTools,
  },
] as const;

const commands: Record<string, AgentTool> = Object.assign(
  {
    read_resource: readResourceTool,
    prepare_document: tool(
      '为文档读取 skill 准备临时文件和工具路径，不解析正文、不复制进项目；需要已安装文档组件。',
      z.object({ ref: resourceRefSchema }).strict(),
      ({ ref }) => prepareDocumentResource(ref),
    ),
    release_document: tool(
      '清理 prepare_document 生成的临时输入与输出；完成正文和图片读取后调用。',
      z.object({ jobId: z.string() }).strict(),
      async ({ jobId }) => {
        await releaseDocumentResource(jobId);
        return { released: true };
      },
    ),
  },
  ...commandDomains.map((domain) => domain.commands),
);

const helpSchema = z
  .object({
    command: z.string().optional(),
    domain: z.enum(['scu', 'mail', 'timetable', 'todo', 'workspace', 'academic']).optional(),
    summary: z.boolean().default(false),
  })
  .strict();

async function executeDomainCommand(name: string, input: unknown) {
  if (name === 'help') {
    const { command: selected, domain, summary } = helpSchema.parse(input);
    const entries = domain
      ? Object.entries(commandDomains.find((item) => item.name === domain)!.commands)
      : Object.entries(commands);
    return entries
      .filter(([name]) => !selected || name === selected)
      .map(([name, command]) => ({
        name,
        description: summary ? command.description.split('。')[0] : command.description,
        ...(!summary && { parameters: z.toJSONSchema(command.schema, { io: 'input' }) }),
      }));
  }
  if (!Object.hasOwn(commands, name)) {
    throw new ToolError('NOT_FOUND', `命令不存在：${name}，请使用 dela help`);
  }
  return commands[name]!.execute(input);
}

/** 本机命令桥（127.0.0.1 随机端口 + Bearer token）：token 只进入 agent 与终端的子进程环境，不含业务凭据。 */
export async function startDomainBridge() {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (
      request.method !== 'POST' ||
      request.url !== '/' ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(403).end(JSON.stringify({ ok: false, error: '请求不可用' }));
      return;
    }
    let commandName: string | undefined;
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 2_000_000) throw new Error('命令输入过大');
      }
      const parsed = z
        .object({ command: z.string().min(1), input: z.unknown().default({}) })
        .strict()
        .parse(JSON.parse(body));
      commandName = parsed.command;
      const result = await executeDomainCommand(parsed.command, parsed.input);
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const schema =
          commandName === 'help'
            ? helpSchema
            : commandName && Object.hasOwn(commands, commandName)
              ? commands[commandName]!.schema
              : undefined;
        response.end(
          JSON.stringify({
            ok: false,
            error: '命令参数无效',
            code: 'INVALID_INPUT',
            issues: error.issues.map(({ path, message }) => ({ path, message })),
            ...(schema && { parameters: z.toJSONSchema(schema, { io: 'input' }) }),
            hint: '按 parameters 修正参数后重试，不要重复相同输入。',
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : '命令失败',
          ...(error instanceof ToolError && { code: error.code }),
          ...(error instanceof ToolError &&
            error.code === 'AUTH_EXPIRED' && {
              retryable: false,
              hint: '停止重试；请用户点击左下角“校园登录”，完成认证后再查询。',
            }),
        }),
      );
    }
  });
  let address = await listen(server);
  // Node fetch（undici）拒绝连接知名服务端口（69、137 等），随机端口偶尔会落入其中。
  for (let attempt = 0; isBlockedPort(address.port) && attempt < 5; attempt++) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    address = await listen(server);
  }
  if (isBlockedPort(address.port)) {
    server.closeAllConnections();
    server.close();
    throw new Error('命令桥未能避开受限端口');
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    token,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<{ address: string; port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const bound = server.address();
      if (!bound || typeof bound === 'string') {
        server.close();
        reject(new Error('命令桥启动失败'));
        return;
      }
      resolve(bound);
    });
  });
}

/** WHATWG Fetch 规范的 bad-IPv4-port 列表（Node fetch 同步拒绝连接这些端口）。 */
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 545, 543, 544, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 991, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
]);
const isBlockedPort = (port: number) => BLOCKED_PORTS.has(port);

export const COMMAND_BRIDGE = `dela() {
  command_name="$1"
  # 不能写 \${2:-{}}：bash 会把默认值截断在第一个 }，再拼出一个字面量 } 破坏 JSON。
  command_json="$2"
  [ -n "$command_json" ] || command_json='{}'
  # 请求体走 stdin：走 argv 时 Windows 会按 ANSI 代码页转码，中文参数到服务端已是替换字符。
  printf '{"command":"%s","input":%s}' "$command_name" "$command_json" | curl --silent --show-error --fail-with-body -H "Authorization: Bearer $DELA_COMMAND_TOKEN" -H 'Content-Type: application/json' --data-binary @- "$DELA_COMMAND_URL"
}`;
