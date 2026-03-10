'use client';
import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useERPStore } from '@/store/erpStore';
import type { ErpConfiguration } from '@/types/database';
import { Loader2, CheckCircle, XCircle, Settings2 } from 'lucide-react';

const schema = z.object({
  provider: z.enum(['sap', 'oracle', 'xero', 'netsuite']),
  label: z.string().min(1, 'Label required'),
  apiUrl: z.string().url('Enter a valid URL'),
  clientId: z.string().min(1, 'Client ID required'),
  clientSecret: z.string().min(1, 'Client secret required'),
  companyCode: z.string().optional(),
  tenantId: z.string().optional(),
  accountId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function ERPSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setErpConfigs, setActiveConfigId } = useERPStore();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

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
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { provider: 'sap' },
  });

  const handleSetActive = async (id: string, is_active: boolean) => {
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
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

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
          credentials: {
            apiUrl: data.apiUrl,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            companyCode: data.companyCode,
            tenantId: data.tenantId,
            accountId: data.accountId,
          },
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

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: data.provider,
          label: data.label,
          credentials: {
            apiUrl: data.apiUrl,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            companyCode: data.companyCode,
            tenantId: data.tenantId,
            accountId: data.accountId,
          },
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

  return (
    <AppShell title="ERP Systems">
      <div className="space-y-6">
        {/* Connect new ERP */}
        <Card>
          <CardHeader>
            <CardTitle>Link ERP System</CardTitle>
            <CardDescription>Connect SAP, Oracle, Xero, or NetSuite to sync invoices and vendors</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ERP Provider</Label>
                  <Select {...register('provider')}>
                    <option value="sap">SAP Digital Currency Hub</option>
                    <option value="oracle">Oracle ERP Cloud</option>
                    <option value="xero">Xero</option>
                    <option value="netsuite">NetSuite</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input placeholder="e.g. Production SAP" {...register('label')} />
                  {errors.label && <p className="text-sm text-red-500">{errors.label.message}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>API URL</Label>
                <Input placeholder="https://api.example.com" {...register('apiUrl')} />
                {errors.apiUrl && <p className="text-sm text-red-500">{errors.apiUrl.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input placeholder="client-id" {...register('clientId')} />
                  {errors.clientId && <p className="text-sm text-red-500">{errors.clientId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <Input type="password" placeholder="••••••••" {...register('clientSecret')} />
                  {errors.clientSecret && <p className="text-sm text-red-500">{errors.clientSecret.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Company Code <span className="text-gray-400">(SAP)</span></Label>
                  <Input placeholder="1000" {...register('companyCode')} />
                </div>
                <div className="space-y-2">
                  <Label>Tenant ID <span className="text-gray-400">(Oracle/Xero)</span></Label>
                  <Input placeholder="tenant-id" {...register('tenantId')} />
                </div>
                <div className="space-y-2">
                  <Label>Account ID <span className="text-gray-400">(NetSuite)</span></Label>
                  <Input placeholder="TSTDRV123456" {...register('accountId')} />
                </div>
              </div>

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

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing…</> : 'Test Connection'}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save & Connect'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Existing configs */}
        {configs && configs.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Linked ERP Systems</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {configs.map((cfg) => (
                  <div key={cfg.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Settings2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{cfg.label}</div>
                        <div className="text-sm text-muted-foreground">
                          {cfg.provider.toUpperCase()} · Last synced: {cfg.last_synced ? new Date(cfg.last_synced).toLocaleDateString() : 'Never'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {cfg.is_active && <Badge variant="success">Active</Badge>}
                      {cfg.is_active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetActive(cfg.id, false)}
                          className="dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleSetActive(cfg.id, true)}>
                          Set Active
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
