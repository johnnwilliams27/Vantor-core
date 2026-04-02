export interface FiatPayment {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  from_bank_account_id: string;
  to_bank_name: string;
  to_account_number: string;
  to_routing_number: string;
  to_account_holder: string;
  amount: string;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  scheduled_for: string | null;
  executed_at: string | null;
  settled_at: string | null;
  estimated_settlement: string | null;
  provider_payment_id: string | null;
  invoice_id: string | null;
  memo: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  from_bank_account?: {
    id: string;
    institution_name: string;
    account_name: string | null;
    last4: string | null;
    nickname: string | null;
  };
}
