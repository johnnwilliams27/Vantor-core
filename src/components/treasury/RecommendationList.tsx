'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI Recommendations
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={generate.isPending}
          className="flex items-center gap-1.5 shrink-0"
        >
          {generate.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyzing…</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" />Generate</>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : !recommendations?.length ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No recommendations yet. Click <span className="font-medium text-foreground">Generate</span> to analyze your treasury.
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {recommendations.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
