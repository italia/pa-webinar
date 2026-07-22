-- Configurable email sender identity.
--
-- WHY: the display name recipients see was hard-wired to the SMTP_FROM_NAME
-- environment variable, so changing it meant a redeploy. It is a piece of
-- public-facing branding, like the site name and the logo, and belongs with the
-- rest of the branding in the admin panel.
--
-- The ADDRESS deliberately stays in SMTP_FROM: the relay authorises a specific
-- sender address, so a value typed in the admin panel could silently break
-- delivery or fail SPF/DKIM. Reply-To is safe to expose, and useful because the
-- From address is a no-reply mailbox.
ALTER TABLE "site_settings" ADD COLUMN "email_from_name" TEXT;
ALTER TABLE "site_settings" ADD COLUMN "email_reply_to" TEXT;
