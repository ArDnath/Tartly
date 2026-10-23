-- First-boot extensions. Runs once, before migrations, on an empty cluster.
-- pg_stat_statements is preloaded in docker-compose.yml; CREATE EXTENSION is
-- what actually makes the view available.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
