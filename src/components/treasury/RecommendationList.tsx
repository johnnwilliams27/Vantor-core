'use client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useTreasuryRecommendations, useGenerateRecommendation } from '@/hooks/useTreasury';
import { RecommendationCard } from './RecommendationCard';
import { Sparkles, Loader2 } from 'lucide-react';

export function RecommendationList() {
  const { data: recommendations, isLoading } = useTreasuryRecommendations();
  const generate = useGenerateRecommendation();
  const { toast } = useToast();

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync();
      toast({ title: 'Recommendation generated', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">AI Recommendations</h2>
        <Button
          onClick={handleGenerate}
          disabled={generate.isPending}
          className="flex items-center gap-2"
        >
          {generate.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate Recommendation
            </>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
      ) : !recommendations?.length ? (
        <div className="text-sm text-muted-foreground text-center py-10 border rounded-lg bg-muted/20">
          No recommendations yet. Click "Generate Recommendation" to analyze your treasury.
        </div>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </div>
  );
}
