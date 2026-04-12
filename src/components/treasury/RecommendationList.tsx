'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useTreasuryRecommendations, useGenerateRecommendation } from '@/hooks/useTreasury';
import { CardSkeleton, CardError } from '@/components/ui/spinner';
import { RecommendationCard } from './RecommendationCard';
import { Sparkles, Loader2 } from 'lucide-react';

export function RecommendationList() {
  const { data: recommendations, isLoading, isError, refetch } = useTreasuryRecommendations();
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Actions Overview
        </CardTitle>
        <button
          onClick={handleGenerate}
          disabled={generate.isPending}
          className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 rounded-sm flex items-center gap-1.5"
        >
          {generate.isPending ? (
            <><Loader2 className="h-3 w-3 animate-spin" />Analyzing…</>
          ) : (
            <><Sparkles className="h-3 w-3" />Generate</>
          )}
        </button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardSkeleton rows={4} />
        ) : isError ? (
          <CardError message="Failed to load recommendations." onRetry={() => refetch()} />
        ) : !recommendations?.length ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No recommendations yet. Click <span className="font-medium text-foreground">Generate</span> to analyze your treasury.
          </div>
        ) : (
          <div className="space-y-3 max-h-[735px] overflow-y-auto pr-1">
            {recommendations.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
