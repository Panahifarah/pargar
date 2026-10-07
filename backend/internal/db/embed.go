package db

import "embed"

// MigrationFiles is the embedded set of .sql migration files.
//
//go:embed migrations/*.sql
var MigrationFiles embed.FS
