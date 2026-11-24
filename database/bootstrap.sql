BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(671263, 1);

DO $bootstrap$
BEGIN
  IF current_database() <> 'auto_finance' THEN
    RAISE EXCEPTION 'Execute o bootstrap no banco dedicado auto_finance.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auto_finance_migrator') THEN
    CREATE ROLE auto_finance_migrator LOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auto_finance_api') THEN
    CREATE ROLE auto_finance_api LOGIN NOINHERIT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles AS role_info
    WHERE role_info.rolname IN ('auto_finance_api', 'auto_finance_migrator')
      AND (
        role_info.rolsuper OR role_info.rolcreatedb OR role_info.rolcreaterole
        OR role_info.rolreplication OR role_info.rolbypassrls OR role_info.rolinherit
        OR NOT role_info.rolcanlogin
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = role_info.oid)
      )
  ) THEN
    RAISE EXCEPTION 'Os papéis da aplicação já existem com privilégios incompatíveis.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_database AS database_info
    JOIN pg_roles AS role_info ON role_info.oid = database_info.datdba
    WHERE database_info.datname = current_database()
      AND role_info.rolname IN ('auto_finance_api', 'auto_finance_migrator')
  ) THEN
    RAISE EXCEPTION 'O banco dedicado exige um proprietário separado da API e da migração.';
  END IF;
END
$bootstrap$;

CREATE SCHEMA IF NOT EXISTS auto_finance AUTHORIZATION auto_finance_migrator;
CREATE SCHEMA IF NOT EXISTS auto_finance_meta AUTHORIZATION auto_finance_migrator;

DO $ownership$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspname IN ('auto_finance', 'auto_finance_meta')
      AND pg_get_userbyid(nspowner) <> 'auto_finance_migrator'
  ) THEN
    RAISE EXCEPTION 'Os esquemas existentes precisam pertencer ao papel de migração.';
  END IF;
END
$ownership$;

REVOKE ALL ON DATABASE auto_finance FROM PUBLIC, auto_finance_api, auto_finance_migrator;
GRANT CONNECT ON DATABASE auto_finance TO auto_finance_api, auto_finance_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, auto_finance_api, auto_finance_migrator;
REVOKE ALL ON SCHEMA auto_finance, auto_finance_meta FROM PUBLIC, auto_finance_api;
GRANT USAGE ON SCHEMA auto_finance TO auto_finance_api;

COMMIT;
