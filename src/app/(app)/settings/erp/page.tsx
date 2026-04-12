'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { PasswordField } from '@/components/ui/password-field';
import { NicknameEdit } from '@/components/ui/nickname-edit';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useERPStore } from '@/store/erpStore';
import { useAppStore } from '@/store/appStore';
import type { ErpConfiguration } from '@/types/database';
import { Loader2, CheckCircle, XCircle, Settings2, Trash2, Pencil, Check, X } from 'lucide-react';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';

/**
 * ERP credentials are provider-specific. The base schema keeps every field
 * optional so the form can swap inputs without re-rendering the resolver;
 * the .superRefine() below enforces which fields are required per provider.
 */
const schema = z
  .object({
    provider: z.enum(['sap', 'oracle', 'xero', 'netsuite', 'quickbooks']),
    label: z.string().min(1, 'Nickname required'),
    apiUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    companyCode: z.string().optional(),
    tenantId: z.string().optional(),
    accountId: z.string().optional(),
    landscape: z.enum(['dev', 'qa', 'prod']).optional(),
    consumerKey: z.string().optional(),
    consumerSecret: z.string().optional(),
    tokenId: z.string().optional(),
    tokenSecret: z.string().optional(),
    realmId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const required: Array<{ key: keyof typeof data; label: string }> = [];
    switch (data.provider) {
      case 'sap':
        required.push(
          { key: 'apiUrl', label: 'API URL' },
          { key: 'clientId', label: 'Client ID' },
          { key: 'clientSecret', label: 'Client Secret' },
          { key: 'companyCode', label: 'Company Code' },
        );
        break;
      case 'oracle':
        required.push(
          { key: 'apiUrl', label: 'API URL' },
          { key: 'clientId', label: 'Client ID' },
          { key: 'clientSecret', label: 'Client Secret' },
          { key: 'tenantId', label: 'Tenant / Instance ID' },
        );
        break;
      case 'netsuite':
        required.push(
          { key: 'accountId', label: 'Account ID' },
          { key: 'consumerKey', label: 'Consumer Key' },
          { key: 'consumerSecret', label: 'Consumer Secret' },
          { key: 'tokenId', label: 'Token ID' },
          { key: 'tokenSecret', label: 'Token Secret' },
        );
        break;
      case 'xero':
        required.push(
          { key: 'clientId', label: 'Client ID' },
          { key: 'clientSecret', label: 'Client Secret' },
          { key: 'tenantId', label: 'Tenant ID' },
        );
        break;
      case 'quickbooks':
        required.push(
          { key: 'clientId', label: 'Client ID' },
          { key: 'clientSecret', label: 'Client Secret' },
          { key: 'realmId', label: 'Realm ID' },
        );
        break;
    }
    for (const { key, label } of required) {
      const value = data[key];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${label} required`,
        });
      }
    }
  });

type FormData = z.infer<typeof schema>;

type ProviderId = FormData['provider'];

const PROVIDER_DOCS: Record<ProviderId, string> = {
  sap: 'https://help.sap.com/docs/SAP_S4HANA_CLOUD',
  oracle: 'https://docs.oracle.com/en/cloud/saas/financials/',
  netsuite: 'https://docs.oracle.com/en/cloud/saas/netsuite/',
  xero: 'https://developer.xero.com/documentation/',
  quickbooks: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
};

const USES_OAUTH: Record<ProviderId, boolean> = {
  sap: false,
  oracle: false,
  netsuite: false,
  xero: true,
  quickbooks: true,
};

const PROVIDER_DISPLAY: Record<ProviderId, string> = {
  sap: 'SAP',
  oracle: 'Oracle',
  netsuite: 'NetSuite',
  xero: 'Xero',
  quickbooks: 'QuickBooks',
};

export default function ERPSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setErpConfigs, setActiveConfigId } = useERPStore();
  const { testMode } = useAppStore();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [showErpAddonConfirm, setShowErpAddonConfirm] = useState(false);
  const [pendingErpData, setPendingErpData] = useState<any>(null);

  const { data: configs, isLoading } = useQuery<ErpConfiguration[]>({
    queryKey: ['erp-configs'],
    queryFn: async () => {
      const res = await fetch('/api/erp/connect');
      if (!res.ok) return [];
      const { data } = await res.json();
      setErpConfigs(data ?? []);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { provider: 'sap', landscape: 'prod' },
    mode: 'onChange',
  });

  const selectedProvider = watch('provider');
  const docsUrl = PROVIDER_DOCS[selectedProvider];
  const isOAuth = USES_OAUTH[selectedProvider];

  const handleSetActive = async (id: string, is_active: boolean) => {
    setActionPending(true);
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      queryClient.invalidateQueries({ queryKey: ['erp-configs'] });
      if (is_active) setActiveConfigId(id);
      else setActiveConfigId(null);
      toast({ title: is_active ? 'ERP reactivated' : 'ERP deactivated', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(false);
      setDeactivateTarget(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionPending(true);
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      queryClient.invalidateQueries({ queryKey: ['erp-configs'] });
      toast({ title: 'ERP system deleted', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(false);
      setDeleteTarget(null);
    }
  };

  const handleSaveNickname = async (id: string, newLabel: string) => {
    const res = await fetch('/api/erp/connect', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label: newLabel }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const err = new Error(json.error || 'Failed to save');
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      throw err;
    }
    queryClient.invalidateQueries({ queryKey: ['erp-configs'] });
    toast({ title: 'Nickname saved', variant: 'success' });
  };

  const buildCredentials = (data: FormData) => ({
    apiUrl: data.apiUrl,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    companyCode: data.companyCode,
    tenantId: data.tenantId,
    accountId: data.accountId,
    landscape: data.landscape,
    consumerKey: data.consumerKey,
    consumerSecret: data.consumerSecret,
    tokenId: data.tokenId,
    tokenSecret: data.tokenSecret,
    realmId: data.realmId,
  });

  const handleTest = async () => {
    const data = getValues();
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: data.provider,
          label: data.label || 'Test',
          credentials: buildCredentials(data),
          testOnly: true,
        }),
      });
      const json = await res.json();
      setTestResult(json.data);
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const doCreateErp = async (data: FormData) => {
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: data.provider,
          label: data.label,
          credentials: buildCredentials(data),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'ERP connected', description: `${data.provider.toUpperCase()} connected successfully`, variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['erp-configs'] });
      setActiveConfigId(json.data.id);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const onSubmit = async (data: FormData) => {
    const liveErps = configs?.filter((c) => c.is_active) ?? [];
    if (!testMode && liveErps.length >= 1) {
      setPendingErpData(data);
      setShowErpAddonConfirm(true);
      return;
    }
    await doCreateErp(data);
  };

  return (
    <>
    <div className="space-y-6">
        {/* Connect new ERP */}
        <Card>
          <CardHeader>
            <CardTitle>Link ERP System</CardTitle>
            <CardDescription>Connect SAP, Oracle, NetSuite, Xero, or QuickBooks to sync invoices and vendors</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ERP Provider</Label>
                  <Select {...register('provider')}>
                    <option value="sap">SAP</option>
                    <option value="oracle">Oracle</option>
                    <option value="netsuite">NetSuite</option>
                    <option value="xero">Xero</option>
                    <option value="quickbooks">QuickBooks</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Nickname</Label>
                  <Input placeholder="e.g. Production SAP" {...register('label')} />
                  {errors.label && <p className="text-sm text-red-500">{errors.label.message}</p>}
                </div>
              </div>

              {isOAuth && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/90 leading-relaxed">
                  {selectedProvider === 'xero'
                    ? 'Xero uses OAuth 2.0 — hosted Connect-with-Xero flow is coming soon. In the meantime, enter the Client ID / Secret and Tenant ID from your app registration below.'
                    : 'QuickBooks uses OAuth 2.0 — hosted Connect-with-Intuit flow is coming soon. In the meantime, enter the Client ID / Secret and Realm ID from your Intuit developer app below.'}
                </div>
              )}

              {/* SAP fields */}
              {selectedProvider === 'sap' && (
                <>
                  <div className="space-y-2">
                    <Label>API URL</Label>
                    <Input placeholder="https://my123456.s4hana.ondemand.com" {...register('apiUrl')} />
                    {errors.apiUrl && <p className="text-sm text-red-500">{errors.apiUrl.message}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input placeholder="client-id" {...register('clientId')} autoComplete="off" />
                      {errors.clientId && <p className="text-sm text-red-500">{errors.clientId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('clientSecret')} />
                      {errors.clientSecret && <p className="text-sm text-red-500">{errors.clientSecret.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        Company Code
                        <InfoTooltip content="The client/company ID in your SAP environment. Find it under System Information or ask your SAP admin." />
                      </Label>
                      <Input placeholder="1000" {...register('companyCode')} />
                      {errors.companyCode && <p className="text-sm text-red-500">{errors.companyCode.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        Landscape
                        <InfoTooltip content="Which SAP landscape to hit. Production is live data. Use QA or Development for testing without touching real transactions." />
                      </Label>
                      <Select {...register('landscape')}>
                        <option value="prod">Production</option>
                        <option value="qa">QA</option>
                        <option value="dev">Development</option>
                      </Select>
                    </div>
                  </div>
                </>
              )}

              {/* Oracle fields */}
              {selectedProvider === 'oracle' && (
                <>
                  <div className="space-y-2">
                    <Label>API URL</Label>
                    <Input placeholder="https://your-tenant.fa.us6.oraclecloud.com" {...register('apiUrl')} />
                    {errors.apiUrl && <p className="text-sm text-red-500">{errors.apiUrl.message}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input placeholder="client-id" {...register('clientId')} autoComplete="off" />
                      {errors.clientId && <p className="text-sm text-red-500">{errors.clientId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('clientSecret')} />
                      {errors.clientSecret && <p className="text-sm text-red-500">{errors.clientSecret.message}</p>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Tenant / Instance ID
                      <InfoTooltip content="Your Oracle Fusion tenant identifier. Find it in the Cloud console URL or under Setup & Maintenance → Tenant." />
                    </Label>
                    <Input placeholder="tenant-id" {...register('tenantId')} />
                    {errors.tenantId && <p className="text-sm text-red-500">{errors.tenantId.message}</p>}
                  </div>
                </>
              )}

              {/* NetSuite fields — token-based auth (TBA) */}
              {selectedProvider === 'netsuite' && (
                <>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Account ID
                      <InfoTooltip content="Your NetSuite account ID (e.g. TSTDRV123456). Visible under Setup → Company → Company Information." />
                    </Label>
                    <Input placeholder="TSTDRV123456" {...register('accountId')} />
                    {errors.accountId && <p className="text-sm text-red-500">{errors.accountId.message}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Consumer Key</Label>
                      <Input placeholder="consumer-key" {...register('consumerKey')} autoComplete="off" />
                      {errors.consumerKey && <p className="text-sm text-red-500">{errors.consumerKey.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Consumer Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('consumerSecret')} />
                      {errors.consumerSecret && <p className="text-sm text-red-500">{errors.consumerSecret.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Token ID</Label>
                      <Input placeholder="token-id" {...register('tokenId')} autoComplete="off" />
                      {errors.tokenId && <p className="text-sm text-red-500">{errors.tokenId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Token Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('tokenSecret')} />
                      {errors.tokenSecret && <p className="text-sm text-red-500">{errors.tokenSecret.message}</p>}
                    </div>
                  </div>
                </>
              )}

              {/* Xero fields */}
              {selectedProvider === 'xero' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input placeholder="client-id" {...register('clientId')} autoComplete="off" />
                      {errors.clientId && <p className="text-sm text-red-500">{errors.clientId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('clientSecret')} />
                      {errors.clientSecret && <p className="text-sm text-red-500">{errors.clientSecret.message}</p>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Tenant ID
                      <InfoTooltip content="Returned by the Xero OAuth flow after you install the app. Visible in the Xero developer app connection list." />
                    </Label>
                    <Input placeholder="tenant-id" {...register('tenantId')} />
                    {errors.tenantId && <p className="text-sm text-red-500">{errors.tenantId.message}</p>}
                  </div>
                </>
              )}

              {/* QuickBooks fields */}
              {selectedProvider === 'quickbooks' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Client ID</Label>
                      <Input placeholder="client-id" {...register('clientId')} autoComplete="off" />
                      {errors.clientId && <p className="text-sm text-red-500">{errors.clientId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Client Secret</Label>
                      <PasswordField placeholder="••••••••" {...register('clientSecret')} />
                      {errors.clientSecret && <p className="text-sm text-red-500">{errors.clientSecret.message}</p>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      Realm ID
                      <InfoTooltip content="Your QuickBooks Online company ID. Returned by the Intuit OAuth callback, also visible at qbo.intuit.com under Settings → Billing & Subscription." />
                    </Label>
                    <Input placeholder="1234567890123456" {...register('realmId')} />
                    {errors.realmId && <p className="text-sm text-red-500">{errors.realmId.message}</p>}
                  </div>
                </>
              )}

              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                Where do I find these? →
              </a>

              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {testResult.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {testResult.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing || !isValid}
                  title={!isValid ? 'Fill required fields to enable' : undefined}
                >
                  {testing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing…</> : 'Test Connection'}
                </Button>
                <Button type="submit" disabled={isSubmitting || !isValid}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</> : 'Save & Connect'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Existing configs */}
        {isLoading ? (
          <TableCardSkeleton columns={5} rows={2} />
        ) : (
          <Card>
            <CardHeader><CardTitle>Linked ERP Systems</CardTitle></CardHeader>
            <CardContent>
              {!configs?.length ? (
                <div className="py-10 text-center space-y-3">
                  <Settings2 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm text-muted-foreground">No ERP systems linked yet.</p>
                  <p className="text-xs text-muted-foreground">Pick a provider above to connect invoices and vendors.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Nickname</TableHead>
                        <TableHead scope="col">Provider</TableHead>
                        <TableHead scope="col">Last Synced</TableHead>
                        <TableHead scope="col">Status</TableHead>
                        <TableHead scope="col" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs.map((cfg) => {
                        const provider = cfg.provider as ProviderId;
                        return (
                          <TableRow key={cfg.id}>
                            <TableCell>
                              <NicknameEdit
                                value={cfg.label}
                                onSave={(v) => handleSaveNickname(cfg.id, v ?? '')}
                                editAriaLabel="Edit ERP nickname"
                                prefixIcon={<Settings2 className="h-4 w-4 text-muted-foreground shrink-0" />}
                              />
                            </TableCell>
                            <TableCell className="text-sm">
                              <Badge variant="outline">{PROVIDER_DISPLAY[provider] ?? cfg.provider}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {cfg.last_synced ? new Date(cfg.last_synced).toLocaleDateString() : 'Never'}
                            </TableCell>
                            <TableCell>
                              {cfg.is_active ? (
                                <Badge variant="success">Active</Badge>
                              ) : (
                                <Badge variant="secondary">Inactive</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-2">
                                {cfg.is_active ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDeactivateTarget({ id: cfg.id, label: cfg.label })}
                                    disabled={actionPending}
                                  >
                                    Deactivate
                                  </Button>
                                ) : (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleSetActive(cfg.id, true)}
                                      disabled={actionPending}
                                    >
                                      Reactivate
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => setDeleteTarget({ id: cfg.id, label: cfg.label })}
                                      disabled={actionPending}
                                      aria-label={`Delete ${cfg.label} configuration`}
                                    >
                                      <Trash2 className="h-4 w-4 text-red-400" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}
        title="Deactivate ERP system?"
        description={`Are you sure you want to deactivate "${deactivateTarget?.label ?? ''}"? It will stop syncing invoices and vendors. You can reactivate it later.`}
        confirmLabel="Deactivate"
        isPending={actionPending}
        onConfirm={() => deactivateTarget && handleSetActive(deactivateTarget.id, false)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete ERP system?"
        description={`Are you sure you want to permanently delete "${deleteTarget?.label ?? ''}"? This will remove all configuration data and cannot be undone.`}
        confirmLabel="Delete"
        isPending={actionPending}
        onConfirm={handleDelete}
      />

      <Dialog
        open={showErpAddonConfirm}
        onOpenChange={(o) => {
          if (!o) {
            setShowErpAddonConfirm(false);
            setPendingErpData(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Additional ERP Add-On</DialogTitle>
            <DialogDescription>
              Adding an additional ERP integration costs{' '}
              <span className="text-foreground font-medium">$1,500/month</span>. This will be added
              to your next bill, pro-rated for the remaining days this month.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowErpAddonConfirm(false);
                setPendingErpData(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setShowErpAddonConfirm(false);
                if (pendingErpData) {
                  await doCreateErp(pendingErpData);
                  setPendingErpData(null);
                }
              }}
            >
              Agree &amp; Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
