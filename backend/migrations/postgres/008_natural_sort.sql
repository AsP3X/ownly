-- Human: Natural filename ordering for the drive browser (A–Z, numeric 0–99).
-- Agent: USED by list_files/list_folders ORDER BY; MATCHES frontend localeCompare numeric sort.

CREATE OR REPLACE FUNCTION natural_sort_key(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT string_agg(
    CASE
      WHEN part ~ '^[0-9]+$' THEN lpad(part, 20, '0')
      ELSE lower(part)
    END,
    ''
  )
  FROM regexp_split_to_table(input, '(\d+)') AS part;
$$;
