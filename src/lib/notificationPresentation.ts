import type { Locale } from './i18n'

export type NotificationEventRow = {
  event_type?: string | null
  payload?: Record<string, unknown> | null
  title?: string | null
  body?: string | null
}

export function notificationPresentation(row: NotificationEventRow, language: Locale) {
  const payload = row.payload || {}
  const reference = String(payload.reference || payload.item || payload.documentReference || '')
  const pt = language === 'pt'
  const catalogue: Record<string, [string, string]> = {
    'inventory.low_stock': [pt ? 'Stock baixo' : 'Low stock', pt ? `${reference} atingiu o nível mínimo.` : `${reference} reached its minimum stock level.`],
    'inventory.out_of_stock': [pt ? 'Sem stock' : 'Out of stock', pt ? `${reference} está sem stock.` : `${reference} is out of stock.`],
    'service_job.completed': [pt ? 'Trabalho de Serviço concluído' : 'Service Job completed', pt ? `${reference} foi concluído.` : `${reference} was completed.`],
    'service_job.costing_reopened': [pt ? 'Custeio do Trabalho de Serviço reaberto' : 'Service Job costing reopened', pt ? `${reference} requer nova revisão de custos.` : `${reference} requires another costing review.`],
    'member.activated': [pt ? 'Novo membro activado' : 'New member activated', pt ? 'Uma adesão à empresa foi activada.' : 'A company membership was activated.'],
    'member.role_changed': [pt ? 'Função de membro alterada' : 'Member role changed', pt ? 'A autoridade de um membro foi actualizada.' : 'A member authority was updated.'],
    'member.disabled': [pt ? 'Membro desactivado' : 'Member disabled', pt ? 'O acesso de um membro foi desactivado.' : 'A member access was disabled.'],
  }
  const resolved = row.event_type ? catalogue[row.event_type] : null
  return { title: resolved?.[0] || row.title || (pt ? 'Notificação' : 'Notification'), body: resolved?.[1] || row.body || '' }
}
