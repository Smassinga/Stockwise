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
    'collections.pause_expired': [pt ? 'Suspensão de cobrança terminada' : 'Collections pause expired', pt ? `A suspensão terminou para ${reference}. Reveja a próxima acção.` : `The pause ended for ${reference}. Review the next action.`],
    'collections.pause_expiring_today': [pt ? 'Suspensão termina hoje' : 'Collections pause expires today', pt ? `A suspensão de ${reference} termina hoje.` : `The pause for ${reference} expires today.`],
    'collections.promise_due_today': [pt ? 'Promessa de pagamento vence hoje' : 'Promise to pay due today', pt ? `A promessa associada a ${reference} vence hoje.` : `The promise for ${reference} is due today.`],
    'collections.promise_kept': [pt ? 'Promessa de pagamento cumprida' : 'Promise to pay kept', pt ? `A promessa associada a ${reference} foi cumprida com evidência financeira.` : `The promise for ${reference} was kept with authoritative financial evidence.`],
    'collections.promise_partially_kept': [pt ? 'Promessa parcialmente cumprida' : 'Promise partially kept', pt ? `${reference} requer acompanhamento do valor ainda em aberto.` : `${reference} needs follow-up for the remaining outstanding amount.`],
    'collections.promise_broken': [pt ? 'Promessa de pagamento não cumprida' : 'Promise to pay broken', pt ? `${reference} requer acompanhamento manual. Nenhum email agressivo foi enviado automaticamente.` : `${reference} requires manual follow-up. No aggressive email was sent automatically.`],
    'collections.dispute_follow_up_due': [pt ? 'Acompanhamento de reclamação' : 'Dispute follow-up due', pt ? `A reclamação de ${reference} requer revisão.` : `The dispute for ${reference} is due for review.`],
    'collections.manual_follow_up_due': [pt ? 'Acompanhamento manual pendente' : 'Manual follow-up due', pt ? `${reference} requer a acção do responsável atribuído.` : `${reference} needs action from the assigned owner.`],
    'collections.control_closed': [pt ? 'Cobrança encerrada' : 'Collections control closed', pt ? `${reference} foi encerrado após liquidação ou crédito autorizado.` : `${reference} closed after authoritative settlement or credit evidence.`],
  }
  const resolved = row.event_type ? catalogue[row.event_type] : null
  return { title: resolved?.[0] || row.title || (pt ? 'Notificação' : 'Notification'), body: resolved?.[1] || row.body || '' }
}
