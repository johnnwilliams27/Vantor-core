'use client';
import { CardSpinner } from '@/components/ui/spinner';
import { CashFlowChart } from '@/components/charts/CashFlowChart';
import { useTreasuryForecast, useGenerateForecast } from '@/hooks/useTreasury';
import { useToast } from '@/components/ui/toast';

export function ForecastingPageClient() {
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
    return <CardSpinner />;
  }

  return (
    <div className="space-y-6">
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
