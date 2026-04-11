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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useERPStore } from '@/store/erpStore';
import { useAppStore } from '@/store/appStore';
import type { ErpConfiguration } from '@/types/database';
import { Loader2, CheckCircle, XCircle, Settings2, Trash2, Pencil, Check, X } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';

// Xero is the only ERP we support for new connections today. SAP, Oracle,
// and NetSuite are coming soon — their providers still exist in the DB
// enum and the Linked list still renders legacy rows of those types, but
// the new-connection form only lets users create Xero configurations.
const schema = z.object({
  provider: z.literal('xero'),
  label: z.string().min(1, 'Nickname required'),
  apiUrl: z.string().url('Enter a valid URL'),
  clientId: z.string().min(1, 'Client ID required'),
  clientSecret: z.string().min(1, 'Client secret required'),
  tenantId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
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
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { provider: 'xero' },
  });

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

  const handleSaveNickname = async (id: string) => {
    setSavingNickname(true);
    try {
      const res = await fetch('/api/erp/connect', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, label: editValue.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save');
      queryClient.invalidateQueries({ queryKey: ['erp-configs'] });
      toast({ title: 'Nickname saved', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSavingNickname(false);
      setEditingId(null);
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
            tenantId: data.tenantId,
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

  const doCreateErp = async (data: FormData) => {
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
            tenantId: data.tenantId,
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
            <CardDescription>Connect Xero to sync invoices, vendors, and obligations</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ERP Provider</Label>
                  <Select {...register('provider')}>
                    <option value="xero">Xero</option>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Oracle, NetSuite, SAP, and Quickbooks coming soon.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Nickname</Label>
                  <Input placeholder="e.g. Production Xero" {...register('label')} />
                  {errors.label && <p className="text-sm text-red-500">{errors.label.message}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>API URL</Label>
                <Input placeholder="https://api.xero.com" {...register('apiUrl')} />
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

              <div className="space-y-2">
                <Label>Tenant ID <span className="text-gray-400">(Xero)</span></Label>
                <Input placeholder="tenant-id" {...register('tenantId')} />
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
          <Card>
            <CardHeader><CardTitle>Linked ERP Systems</CardTitle></CardHeader>
            <CardContent>
        {isLoading ? (
              <CardSpinner />
        ) : !configs?.length ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No ERP systems linked yet. Connect one above.
              </div>
        ) : (
              <div className="space-y-3">
                {configs.map((cfg) => {
                  const isEditing = editingId === cfg.id;
                  return (
                  <div key={cfg.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Settings2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="Enter nickname…"
                              className="h-7 text-sm w-44"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editValue.trim()) handleSaveNickname(cfg.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              disabled={savingNickname}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveNickname(cfg.id)} disabled={savingNickname || !editValue.trim()}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)} disabled={savingNickname}>
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{cfg.label}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => { setEditingId(cfg.id); setEditValue(cfg.label); }}
                            >
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                        )}
                        <div className="text-sm text-muted-foreground">
                          {cfg.provider.toUpperCase()} · Last synced: {cfg.last_synced ? new Date(cfg.last_synced).toLocaleDateString() : 'Never'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {cfg.is_active ? (
                        <>
                          <Badge variant="success">Active</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeactivateTarget({ id: cfg.id, label: cfg.label })}
                            disabled={actionPending}
                          >
                            Deactivate
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="secondary">Inactive</Badge>
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
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
        )}
            </CardContent>
          </Card>
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

      {showErpAddonConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Additional ERP Add-On</h2>
            <p className="text-sm text-muted-foreground">
              Adding an additional ERP integration costs <span className="text-foreground font-medium">$1,500/month</span>. This will be added to your next bill, pro-rated for the remaining days this month.
            </p>
            <div className="flex justify-end gap-3 pt-2">
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
