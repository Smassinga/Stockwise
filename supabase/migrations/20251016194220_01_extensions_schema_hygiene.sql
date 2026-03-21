DO $$ BEGIN
  BEGIN
    EXECUTE 'ALTER EXTENSION http SET SCHEMA extensions';
  EXCEPTION WHEN OTHERS THEN
    -- Ignore if already moved or not installed
    NULL;
  END;
  BEGIN
    EXECUTE 'ALTER EXTENSION pgjwt SET SCHEMA extensions';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END$$;;
