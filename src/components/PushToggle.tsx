import { useMutation } from '@tanstack/react-query'
import { Button, Card, Notice } from '@/components/ui'
import { errorMessage } from '@/lib/api'
import { usePush } from '@/lib/push'

export function PushToggle() {
  const push = usePush()
  const toggle = useMutation({ mutationFn: () => (push.state === 'on' ? push.disable() : push.enable()) })
  const test = useMutation({ mutationFn: push.test })

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">🔔 Avisos de novos horários</p>
          <p className="text-sm text-muted">
            {push.state === 'on'
              ? 'Ativo neste aparelho.'
              : push.state === 'needs-install'
                ? 'No iPhone: toque em Compartilhar → "Adicionar à Tela de Início" e abra o app por lá.'
                : push.state === 'denied'
                  ? 'Bloqueado. Libere as notificações nas configurações do navegador.'
                  : push.state === 'unsupported'
                    ? 'Este navegador não suporta notificações.'
                    : 'Receba um aviso no celular a cada agendamento.'}
          </p>
        </div>
        {push.state === 'on' || push.state === 'off' ? (
          <Button
            size="sm"
            variant={push.state === 'on' ? 'secondary' : 'primary'}
            loading={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {push.state === 'on' ? 'Desativar' : 'Ativar'}
          </Button>
        ) : null}
      </div>
      {push.state === 'on' ? (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3" loading={test.isPending} onClick={() => test.mutate()}>
          Enviar teste
        </Button>
      ) : null}
      {toggle.isError ? (
        <div className="mt-3">
          <Notice tone="error">{errorMessage(toggle.error)}</Notice>
        </div>
      ) : null}
      {test.isError ? (
        <div className="mt-3">
          <Notice tone="error">{errorMessage(test.error)}</Notice>
        </div>
      ) : null}
    </Card>
  )
}
