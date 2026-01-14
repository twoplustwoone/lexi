ALTER TABLE auth_email_password
ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1;
