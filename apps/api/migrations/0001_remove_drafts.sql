DELETE FROM "challenges" WHERE "status" = 'draft';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'challenge_status_check'
      AND conrelid = 'public.challenges'::regclass
  ) THEN
    ALTER TABLE "challenges" ADD CONSTRAINT "challenge_status_check" CHECK ("status" IN ('open', 'resolving', 'provisional_resolved', 'final_resolved', 'cancelled', 'expired_unmatched', 'voided', 'disputed'));
  END IF;
END $$;
