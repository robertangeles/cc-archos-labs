-- Split internal-routing email from publicly-displayed email.
--
-- consultant.email stays the internal routing address (where Resend
-- sends "you have a new booking" notifications + what the OAuth flow
-- uses to identify the consultant). consultant.public_email is what
-- the booking page surfaces in the escape-hatch.
--
-- For the only existing row, we seed public_email to the branded
-- domain address. Future rows default to NULL; the booking page falls
-- back to `email` when public_email is unset.

ALTER TABLE "consultant" ADD COLUMN "public_email" text;--> statement-breakpoint

UPDATE "consultant"
SET "public_email" = 'rob.angeles@archoslabs.xyz'
WHERE "email" = 'trebor.selegna@outlook.com';
