'use client';
import { useState } from 'react';
import { CardSpinner } from '@/components/ui/spinner';
import { CashFlowChart } from '@/components/charts/CashFlowChart';
import {
  useTreasuryForecast,
  useGenerateForecast,
  type ForecastScenarioOption,
} from '@/hooks/useTreasury';
import { useToast } from '@/components/ui/toast';

const SCENARIO_OPTIONS: Array<{ value: ForecastScenarioOption; label: string; hint: string }> = [
  { value: 'base', label: 'Base', hint: 'Confirmed + expected obligations, current FX' },
  { value: 'conservative', label: 'Conservative', hint: 'Confirmed only, current FX' },
  { value: 'stress', label: 'Stress', hint: 'Confirmed only, 20% drawdown, pessimistic FX' },
];

export function ForecastingPageClient() {
  const [scenario, setScenario] = useState<ForecastScenarioOption>('base');
  const { data: forecast, isLoading } = useTreasuryForecast(30, scenario);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="forecast-scenario"
          className="text-sm font-medium text-muted-foreground"
        >
          Scenario
        </label>
        <select
          id="forecast-scenario"
          value={scenario}
          onChange={(e) => setScenario(e.target.value as ForecastScenarioOption)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          {SCENARIO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {SCENARIO_OPTIONS.find((o) => o.value === scenario)?.hint}
        </span>
      </div>

      {isLoading ? (
        <CardSpinner />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
