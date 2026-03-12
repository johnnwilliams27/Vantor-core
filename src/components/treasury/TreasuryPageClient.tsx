'use client';
import { useState } from 'react';
import { UnifiedBalanceCard } from './UnifiedBalanceCard';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { ObligationsPanel } from './ObligationsPanel';
import { RecommendationList } from './RecommendationList';
import { TreasuryReportPanel } from './TreasuryReportPanel';
import { CashFlowChart } from '@/components/charts/CashFlowChart';
import { Button } from '@/components/ui/button';
import { useTreasuryForecast, useGenerateForecast } from '@/hooks/useTreasury';
import { useToast } from '@/components/ui/toast';
import { TrendingUp, FileBarChart } from 'lucide-react';

type ActivePanel = 'forecast' | 'report' | null;

function ForecastSection() {
  const { data: forecast, isLoading } = useTreasuryForecast(30);
  const generateForecast = useGenerateForecast();
  const { toast } = useToast();

  const handleGenerate = async () => {
    try {
      await generateForecast.mutateAsync({ lookahead_days: 30 });
      toast({ title: 'Forecast generated', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Forecast generation failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        Loading forecast…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {forecast?.ai_summary && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">AI Summary: </span>
          {forecast.ai_summary}
        </div>
      )}
      <CashFlowChart
        forecastData={forecast?.forecast_data ?? []}
        onGenerateForecast={handleGenerate}
        isGenerating={generateForecast.isPending}
      />
    </div>
  );
}

export function TreasuryPageClient() {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  const toggle = (panel: ActivePanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  return (
    <div className="space-y-6">
      {/* Unified balance overview */}
      <UnifiedBalanceCard />

      {/* Rules + Obligations side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TreasuryRulesForm />
        <ObligationsPanel />
      </div>

      {/* Recommendation list */}
      <RecommendationList />

      {/* Phase 2 toggle row */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
        <Button
          variant={activePanel === 'forecast' ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggle('forecast')}
          className="flex items-center gap-1.5"
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Forecast
        </Button>

        <Button
          variant={activePanel === 'report' ? 'default' : 'outline'}
          size="sm"
          onClick={() => toggle('report')}
          className="flex items-center gap-1.5"
        >
          <FileBarChart className="h-3.5 w-3.5" />
          Report
        </Button>
      </div>

      {/* Conditionally rendered panels — lazy mount (no data fetched until opened) */}
      {activePanel === 'forecast' && <ForecastSection />}
      {activePanel === 'report' && <TreasuryReportPanel />}
    </div>
  );
}
