ALTER TABLE "trips" DROP CONSTRAINT "trips_cancellation_check";

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_cancellation_check" CHECK (
    (
      "status" = 'CANCELLED'
      AND "cancelled_at" IS NOT NULL
      AND "cancelled_by_actor_id" IS NOT NULL
      AND "cancellation_reason" IS NOT NULL
      AND length(btrim("cancellation_reason")) > 0
    )
    OR (
      "status" <> 'CANCELLED'
      AND "cancelled_at" IS NULL
      AND "cancelled_by_actor_id" IS NULL
      AND "cancellation_reason" IS NULL
    )
  );
