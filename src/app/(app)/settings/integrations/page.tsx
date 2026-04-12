'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { SlackLogo } from '@/components/ui/icons/slack-logo';
import { PasswordField } from '@/components/ui/password-field';
import {
  MsTeamsLogo,
  EmailLogo,
  WebhookLogo,
  ZapierLogo,
  PagerDutyLogo,
} from '@/components/ui/icons/integration-logos';

interface ComingSoonIntegration {
  name: string;
  description: string;
  Logo: React.ComponentType<{ size?: number; className?: string }>;
}

const COMING_SOON_INTEGRATIONS: ComingSoonIntegration[] = [
  {
    name: 'Microsoft Teams',
    description: 'Post recommendations to a Teams channel and approve inline, same flow as Slack.',
    Logo: MsTeamsLogo,
  },
  {
    name: 'Email (SMTP / Resend)',
    description: 'Send daily digests and critical alerts to a distribution list or shared inbox.',
    Logo: EmailLogo,
  },
  {
    name: 'Webhooks',
    description: 'POST treasury events to a custom HTTPS endpoint for SIEM, Datadog, or homegrown tools.',
    Logo: WebhookLogo,
  },
  {
    name: 'Zapier',
    description: 'Connect Vantor to 7,000+ apps without writing custom integration code.',
    Logo: ZapierLogo,
  },
  {
    name: 'PagerDuty',
    description: 'Escalate severe compliance or execution alerts to an on-call rotation.',
    Logo: PagerDutyLogo,
  },
];

function ComingSoonCard({ integration }: { integration: ComingSoonIntegration }) {
  const { Logo } = integration;
  return (
    <Card className="opacity-75">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
              <Logo size={22} />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">{integration.name}</CardTitle>
              <CardDescription className="mt-1 text-xs leading-relaxed">
                {integration.description}
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">Coming soon</Badge>
        </div>
      </CardHeader>
    </Card>
  );
}

const schema = z.object({
  botToken: z.string().min(1, 'Bot token required').max(500),
  signingSecret: z.string().min(1, 'Signing secret required').max(200),
  channelId: z.string().min(1, 'Channel ID required').max(20),
  channelName: z.string().max(100).optional(),
  workspaceName: z.string().max(200).optional(),
});

type FormData = z.infer<typeof schema>;

interface SlackConfig {
  id: string;
  workspace_name: string | null;
  team_id: string | null;
  channel_id: string;
  channel_name: string | null;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
}

export default function IntegrationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/integrations/slack/callback`
    : '/api/integrations/slack/callback';

  const { data: config, isLoading } = useQuery<SlackConfig | null>({
    queryKey: ['slack-integration'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/slack');
      if (!res.ok) return null;
      const { data } = await res.json();
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const isConnected = !!config;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch('/api/integrations/slack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Slack connected', description: 'Slack integration saved successfully', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['slack-integration'] });
      reset();
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/integrations/slack/test', { method: 'POST' });
      const json = await res.json();
      setTestResult({ success: json.success, message: json.message });
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/integrations/slack', { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Slack disconnected', description: 'Slack integration removed', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['slack-integration'] });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
        {/* Slack Integration Card */}
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
                  <SlackLogo size={22} />
                </span>
                <div>
                  <CardTitle>Slack</CardTitle>
                  <CardDescription>
                    Post treasury recommendations to Slack and approve or deny them directly from the channel.
                  </CardDescription>
                </div>
              </div>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : isConnected ? (
                <Badge variant="success">Connected</Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Connected state */}
            {isConnected && config && (
              <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Connected</span>
                  {config.workspace_name && (
                    <span className="text-muted-foreground">— {config.workspace_name}</span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  Channel: <span className="font-mono">{config.channel_name ? `#${config.channel_name}` : config.channel_id}</span>
                  {config.verified_at && (
                    <> · Connected {new Date(config.verified_at).toLocaleDateString()}</>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Sending…</> : 'Test Connection'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    {disconnecting ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Disconnecting…</> : 'Disconnect'}
                  </Button>
                </div>
                {testResult && (
                  <div className={`flex items-center gap-2 p-2 rounded text-sm ${
                    testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                  }`}>
                    {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {testResult.message}
                  </div>
                )}
              </div>
            )}

            {/* Setup Instructions */}
            {!isConnected && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-3 text-sm">
                  <p className="font-medium">Setup Instructions</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <a
                        href="https://api.slack.com/apps"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline inline-flex items-center gap-1"
                      >
                        Create a Slack app <ExternalLink className="h-3 w-3" />
                      </a>
                      {' '}at api.slack.com/apps
                    </li>
                    <li>Under <strong>OAuth &amp; Permissions</strong>, add bot scopes: <code className="bg-muted px-1 rounded">chat:write</code>, <code className="bg-muted px-1 rounded">chat:write.public</code></li>
                    <li>Install the app to your workspace and copy the <strong>Bot User OAuth Token</strong></li>
                    <li>Under <strong>Basic Information</strong>, copy the <strong>Signing Secret</strong></li>
                    <li>
                      Under <strong>Interactivity &amp; Shortcuts</strong>, enable interactivity and paste this callback URL:
                      <div className="flex items-center gap-2 mt-1.5">
                        <code className="bg-muted px-2 py-1 rounded text-xs flex-1 break-all">{callbackUrl}</code>
                        <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
                          {copied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
                        </Button>
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        ⚠️ This URL must be publicly reachable. Use your production URL or an ngrok tunnel in dev.
                      </p>
                    </li>
                  </ol>
                </div>

                {/* Connect form */}
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Bot User OAuth Token</Label>
                    <PasswordField placeholder="xoxb-…" {...register('botToken')} />
                    {errors.botToken && <p className="text-sm text-red-500">{errors.botToken.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label>Signing Secret</Label>
                    <PasswordField placeholder="••••••••••••" {...register('signingSecret')} />
                    {errors.signingSecret && <p className="text-sm text-red-500">{errors.signingSecret.message}</p>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Channel ID</Label>
                      <Input placeholder="C0123456789" {...register('channelId')} />
                      <p className="text-xs text-muted-foreground">Right-click the channel → Copy link, the ID is the last segment</p>
                      {errors.channelId && <p className="text-sm text-red-500">{errors.channelId.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Channel Name <span className="text-muted-foreground">(optional)</span></Label>
                      <Input placeholder="treasury-alerts" {...register('channelName')} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Workspace Name <span className="text-muted-foreground">(optional)</span></Label>
                    <Input placeholder="My Company" {...register('workspaceName')} />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-[#4A154B] hover:bg-[#3a1139] text-white border-0"
                  >
                    {isSubmitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
                    ) : (
                      <>
                        <SlackLogo size={16} className="mr-2" />
                        Connect Slack
                      </>
                    )}
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Coming soon */}
        <div className="space-y-3 pt-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Coming soon
            </h2>
            <span className="text-xs text-muted-foreground">
              Want one sooner? <a href="mailto:support@vantor.xyz" className="text-teal-500 hover:underline">Let us know</a>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMING_SOON_INTEGRATIONS.map((integration) => (
              <ComingSoonCard key={integration.name} integration={integration} />
            ))}
          </div>
        </div>
      </div>
  );
}
