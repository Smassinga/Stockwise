import { supabase } from './supabase'

export type PaymentPlanOption = {
  plan_code: string
  display_name: string
  billing_period: 'monthly' | 'six_month' | 'annual'
  amount: number
  currency_code: string
}

export type PaymentChannel = {
  id: string
  method_code: string
  display_name: string
  provider_category: string
  destination_identifier: string
  account_name: string | null
  currency_code: string
  operator_instructions: string | null
  customer_instructions: string
  is_active: boolean
  sort_order: number
  effective_from: string | null
  effective_until: string | null
  created_at: string
  updated_at: string
}

export type PaymentRequest = {
  id: string
  reference: string
  company_id: string
  requested_plan_code: string
  plan_name_snapshot: string
  billing_period_snapshot: string
  expected_amount_snapshot: number
  currency_snapshot: string
  payment_channel_id: string
  payment_channel_display_snapshot: string
  payment_destination_snapshot: string
  payment_instructions_snapshot: string
  payer_name: string | null
  payer_phone: string | null
  provider_transaction_reference: string | null
  declared_paid_amount: number | null
  amount_mismatch: boolean
  proof_mime_type: string | null
  proof_size_bytes: number | null
  status: string
  company_submission_note: string | null
  platform_review_note: string | null
  correction_reason: string | null
  submitted_at: string | null
  approved_at: string | null
  approved_paid_until_snapshot: string | null
  created_at: string
  company_name?: string
  current_access_status?: string
  current_plan_code?: string
  current_paid_until?: string | null
}

export type PaymentRequestEvent = {
  id: string
  sequence: number
  event_type: string
  previous_status: string | null
  new_status: string | null
  reason: string | null
  created_at: string
}

async function rpc<T>(name: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data as T
}

export const paymentActivationApi = {
  listPlans: () => rpc<PaymentPlanOption[]>('list_available_payment_plans'),
  listChannels: () => rpc<PaymentChannel[]>('list_available_payment_channels'),
  listRequests: (companyId: string) =>
    rpc<PaymentRequest[]>('list_my_company_payment_requests', { p_company_id: companyId }),
  getRequest: (requestId: string) =>
    rpc<{ request: PaymentRequest; events: PaymentRequestEvent[] }>('get_my_company_payment_request', { p_request_id: requestId }),
  createRequest: (companyId: string, planCode: string, period: string, channelId: string, requestKey: string) =>
    rpc<{ request_id: string; reference: string; upload_path: string; expected_amount: number; currency: string }>(
      'create_company_payment_request',
      { p_company_id: companyId, p_plan_code: planCode, p_billing_period: period, p_payment_channel_id: channelId, p_request_key: requestKey },
    ),
  updateDraft: (args: {
    requestId: string; planCode: string; period: string; channelId: string; payerName: string; payerPhone: string;
    transactionReference: string; declaredAmount: number; note: string; requestKey: string
  }) => rpc('update_company_payment_request_draft', {
    p_request_id: args.requestId, p_plan_code: args.planCode, p_billing_period: args.period,
    p_payment_channel_id: args.channelId, p_payer_name: args.payerName, p_payer_phone: args.payerPhone,
    p_transaction_reference: args.transactionReference, p_declared_amount: args.declaredAmount,
    p_note: args.note, p_request_key: args.requestKey,
  }),
  uploadProof: async (path: string, file: File) => {
    const { error } = await supabase.storage.from('payment-proofs').upload(path, file, {
      contentType: file.type,
      upsert: true,
    })
    if (error) throw error
  },
  attachProof: (requestId: string, requestKey: string) =>
    rpc('attach_company_payment_request_proof', { p_request_id: requestId, p_request_key: requestKey }),
  submit: (requestId: string, requestKey: string, resubmit = false) =>
    rpc(resubmit ? 'resubmit_company_payment_request' : 'submit_company_payment_request', { p_request_id: requestId, p_request_key: requestKey }),
  cancel: (requestId: string, reason: string, requestKey: string) =>
    rpc('cancel_company_payment_request', { p_request_id: requestId, p_reason: reason, p_request_key: requestKey }),
  createProofUrl: async (requestId: string, platform = false) => {
    const authorization = await rpc<{ bucket: string; path: string; expires_in: number }>(
      platform ? 'platform_admin_authorize_payment_proof_access' : 'authorize_company_payment_proof_access',
      { p_request_id: requestId },
    )
    const { data, error } = await supabase.storage.from(authorization.bucket).createSignedUrl(authorization.path, authorization.expires_in)
    if (error) throw error
    return data.signedUrl
  },
  adminListChannels: () => rpc<PaymentChannel[]>('platform_admin_list_payment_channels'),
  adminUpsertChannel: (channel: Partial<PaymentChannel> & { method_code: string; display_name: string; provider_category: string; destination_identifier: string; customer_instructions: string }) =>
    rpc<string>('platform_admin_upsert_payment_channel', {
      p_id: channel.id ?? null, p_method_code: channel.method_code, p_display_name: channel.display_name,
      p_provider_category: channel.provider_category, p_destination_identifier: channel.destination_identifier,
      p_account_name: channel.account_name ?? null, p_currency_code: channel.currency_code ?? 'MZN',
      p_operator_instructions: channel.operator_instructions ?? null, p_customer_instructions: channel.customer_instructions,
      p_is_active: channel.is_active ?? false, p_sort_order: channel.sort_order ?? 100,
      p_effective_from: channel.effective_from ?? null, p_effective_until: channel.effective_until ?? null,
    }),
  adminSetChannelStatus: (channelId: string, active: boolean) =>
    rpc('platform_admin_set_payment_channel_status', { p_channel_id: channelId, p_is_active: active }),
  adminListRequests: async (status: string | null, search: string | null) => {
    const rows = await rpc<Array<{ request_data: PaymentRequest }>>('platform_admin_list_payment_requests', { p_status: status, p_search: search })
    return rows.map((row) => row.request_data)
  },
  adminGetRequest: (requestId: string) =>
    rpc<{ request: PaymentRequest; events: PaymentRequestEvent[] }>('platform_admin_get_payment_request', { p_request_id: requestId }),
  adminStartReview: (requestId: string, note: string, requestKey: string) =>
    rpc('platform_admin_start_payment_review', { p_request_id: requestId, p_note: note, p_request_key: requestKey }),
  adminRequestCorrection: (requestId: string, reason: string, requestKey: string) =>
    rpc('platform_admin_request_payment_correction', { p_request_id: requestId, p_reason: reason, p_request_key: requestKey }),
  adminReject: (requestId: string, reason: string, requestKey: string) =>
    rpc('platform_admin_reject_payment_request', { p_request_id: requestId, p_reason: reason, p_request_key: requestKey }),
  adminApprove: (requestId: string, note: string, requestKey: string) =>
    rpc('platform_admin_approve_payment_request', { p_request_id: requestId, p_review_note: note, p_request_key: requestKey }),
}
