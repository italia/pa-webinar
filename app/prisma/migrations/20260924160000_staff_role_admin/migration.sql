-- Amministratori nominali accanto agli organizzatori (account dello staff).
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMIN';
