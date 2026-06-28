-- CDMP Specialist exams: exam typing on cdmp_exam_session. Additive; existing
-- rows default to 'fundamentals'.
ALTER TABLE "cdmp_exam_session" ADD COLUMN IF NOT EXISTS "exam_type" text DEFAULT 'fundamentals' NOT NULL;--> statement-breakpoint
ALTER TABLE "cdmp_exam_session" ADD COLUMN IF NOT EXISTS "specialist_area" text;--> statement-breakpoint
-- Admin analytics: "completed specialist exams per subject."
CREATE INDEX IF NOT EXISTS "cdmp_exam_session_specialist_area_idx" ON "cdmp_exam_session" USING btree ("specialist_area");