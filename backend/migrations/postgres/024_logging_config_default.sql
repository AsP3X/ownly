-- Human: Seed default runtime logging preset for admin-configurable tracing filters.
-- Agent: WRITES app_settings.logging_config JSON; ON CONFLICT preserves existing admin overrides.

INSERT INTO app_settings (key, value)
VALUES (
    'logging_config',
    '{"preset":"default","categories":{}}'
)
ON CONFLICT (key) DO NOTHING;
