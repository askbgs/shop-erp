-- Public tracking code for repair jobs. Job numbers (e.g. TRI-JOB-000001) repeat across
-- shops, so the public tracking page needs a code that is unique across the whole system.
ALTER TABLE "repair_jobs" ADD COLUMN "trackCode" TEXT;

-- Back-fill existing jobs with a random 10-character code.
UPDATE "repair_jobs"
   SET "trackCode" = upper(substr(md5(random()::text || id), 1, 10))
 WHERE "trackCode" IS NULL;

ALTER TABLE "repair_jobs" ALTER COLUMN "trackCode" SET NOT NULL;

CREATE UNIQUE INDEX "repair_jobs_trackCode_key" ON "repair_jobs"("trackCode");
