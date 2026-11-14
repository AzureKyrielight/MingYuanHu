/** 校园登录：学号 + 密码换取访问令牌，或走统一认证网页登录。登录成功后进入校园服务。 */
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Globe, LogOut, X } from 'lucide-react';
import type { ScuIdentityState } from '../../../shared/scu';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { chromeIconButton } from '../../navigation/nav-styles';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { cn } from '../../lib/utils';

interface CampusLoginDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnected: () => void;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim();
}

export function CampusLoginDialog({ open, onOpenChange, onConnected }: CampusLoginDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ScuIdentityState | null>(null);

  const refresh = useCallback(async () => {
    if (!window.dela) return;
    setIdentity(await window.dela.scu.identityState());
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      void refresh();
    }
  }, [open, refresh]);

  const finish = () => {
    onOpenChange(false);
    window.dispatchEvent(new Event('scu-identity-changed'));
    onConnected();
  };

  const loginToken = async () => {
    if (!window.dela) return;
    setError(null);
    setBusy(true);
    try {
      setIdentity(
        await window.dela.scu.identityLoginAuto({
          username: username.trim(),
          password,
        }),
      );
      setPassword('');
      finish();
    } catch (cause) {
      setError(cleanError(cause));
    } finally {
      setBusy(false);
    }
  };

  const loginWeb = async () => {
    if (!window.dela) return;
    setError(null);
    setBusy(true);
    try {
      const result = await window.dela.scu.connect();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      finish();
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!window.dela) return;
    setIdentity(await window.dela.scu.identityLogout());
    window.dispatchEvent(new Event('scu-identity-changed'));
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'w-[26rem] max-w-[92vw] p-6')}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">校园登录</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-ink-3">
                教务、电费、体测与办事大厅等数据来自四川大学各业务系统。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className={cn(chromeIconButton, '-mr-1 -mt-1')}
                type="button"
              >
                <X className="size-4" strokeWidth={1.8} />
              </button>
            </Dialog.Close>
          </div>

          {identity?.connected ? (
            <div className="mt-6 grid gap-3">
              <p className="text-sm text-ink-2">
                已登录{identity.principal ? ` · ${identity.principal}` : ''}
                {identity.expiresAt
                  ? ` · 有效至 ${new Date(identity.expiresAt).toLocaleTimeString()}`
                  : ''}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={finish}>
                  进入校园服务
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void logout()}>
                  <LogOut className="size-4" />
                  退出密码登录
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-6 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && username.trim() && password) void loginToken();
              }}
            >
              <Input
                autoFocus
                placeholder="学号"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Input
                type="password"
                placeholder="统一身份认证密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button disabled={busy || !username.trim() || !password} type="submit">
                {busy ? '登录中…' : '密码登录'}
              </Button>
              <p className="text-xs text-ink-3">
                验证码由本地 OCR 识别；密码只在本次登录使用，不写入磁盘与日志。
              </p>
            </form>
          )}

          {error && (
            <p className="mt-3 text-xs text-red" role="alert">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2"
              disabled={busy}
              onClick={() => void loginWeb()}
              type="button"
            >
              <Globe className="size-4" strokeWidth={1.8} />
              改用统一认证网页登录
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
