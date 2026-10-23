-- SEC-45: schema-level default revokes do not remove PostgreSQL's global
-- default EXECUTE grant to PUBLIC. Revoke it for future postgres-owned funcs.
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
    WHERE defaults.defaclrole = 'postgres'::regrole
      AND defaults.defaclnamespace = 0
      AND defaults.defaclobjtype = 'f'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SEC-45: postgres global function defaults still grant EXECUTE to PUBLIC';
  END IF;
END;
$$;

COMMIT;
